/**
 * POST /api/auth/cadastro
 * Body: { nome, email, senha, papel? }
 *
 * Hierarquia da equipe (ver database/final/schema-postgresql.sql):
 *   - cadastro comum (sem papel): vira 'cliente', com login automático;
 *   - papel:'equipe' exige uma sessão de equipe e vale assim:
 *       barbeiro MASTER  -> cria barbeiro comum, ou outro MASTER se enviar
 *                           master:true E confirmarRiscoMaster:true (a tela
 *                           mostra um aviso obrigatório antes);
 *       barbeiro comum COM permissão (pode_criar_barbeiros, dada por um
 *                           master) -> cria SOMENTE barbeiro comum;
 *       barbeiro comum SEM permissão / cliente / sem sessão -> 403.
 *     (Antes, quem não podia criar barbeiro recebia uma conta de cliente
 *     no lugar, e o login automático trocava a sessão de quem chamou.)
 *
 * A conta fica utilizável IMEDIATAMENTE — login automático já na resposta
 * deste endpoint (exceto quando é a equipe criando a conta de um colega,
 * ver comentário mais abaixo). Um e-mail de confirmação é enviado em
 * paralelo (best-effort, nunca bloqueia nada — ver comentário abaixo e
 * _lib/email.js), do mesmo jeito que "esqueci minha senha" é um recurso
 * disponível mas opcional: existe, funciona quando o Resend estiver
 * configurado com domínio próprio, mas nada no site depende dele.
 *
 * Por que não bloquear a conta até confirmar: sem domínio configurado no
 * Resend (nosso caso hoje, só com *.netlify.app), o e-mail de confirmação
 * nunca chega de verdade pra um cliente real — só aparece nos logs da
 * function, que só o dono do site consegue ver (ver _lib/email.js). Se a
 * conta ficasse travada até confirmar, TODO cadastro ficaria
 * permanentemente inutilizável em produção sem domínio. A coluna
 * usuarios.email_verificado continua existindo e sendo preenchida —
 * só não é mais uma trava de acesso (ver auth-login.js).
 */
const bcrypt = require('bcryptjs');
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJsonLimitado: corpoJson, ipDoCliente, comProtecao } = require('./_lib/http');
const { excedeuLimite, registrarUso } = require('./_lib/limite');
const { getUsuarioDaSessao, criarSessao } = require('./_lib/sessao');
const { gerarTokenBruto, hashToken } = require('./_lib/tokens');
const { enviarEmailVerificacao } = require('./_lib/email');

const CUSTO_BCRYPT = 12;
const VALIDADE_TOKEN_HORAS = 24;

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const dados = corpoJson(event);
  if (!dados) return erro(400, 'JSON inválido.');

  const nome = String(dados.nome || '').trim();
  const email = String(dados.email || '').trim().toLowerCase();
  const senha = String(dados.senha || '');
  if (typeof dados.nome === 'object' || typeof dados.email === 'object' || typeof dados.senha === 'object') {
    return erro(400, 'Dados inválidos.');
  }

  if (!nome || !email || !senha) {
    return erro(400, 'Preencha nome, e-mail e senha.');
  }
  // usuarios.nome e usuarios.email são VARCHAR(120)/VARCHAR(190) no banco
  // (ver database/final/schema-postgresql.sql) — sem checar aqui, um nome
  // ou e-mail longo demais não virava um erro 400 explicado, e sim um erro
  // 500 cru do Postgres ("value too long for type character varying").
  if (nome.length > 120) return erro(400, 'Nome muito longo (máximo 120 caracteres).');
  if (email.length > 190) return erro(400, 'E-mail muito longo (máximo 190 caracteres).');
  // Checagem simples de formato — não pega tudo que é e-mail inválido,
  // mas evita cadastrar algo como "asdf" sem "@" nenhum.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return erro(400, 'Informe um e-mail válido.');
  }
  if (senha.length < 6) {
    return erro(400, 'A senha deve ter pelo menos 6 caracteres.');
  }
  // bcrypt só considera os primeiros 72 bytes; sem teto, uma senha de
  // vários MB gastava CPU (hash + regex) só para ser recusada/aceita.
  if (senha.length > 128) {
    return erro(400, 'A senha deve ter no máximo 128 caracteres.');
  }

  const sql = getSql();

  // E-mail único de verdade agora (nenhuma conta fica "pendente" — toda
  // linha em usuarios já é uma conta ativa desde a criação), então a
  // checagem é simples: existe com esse e-mail? Já está em uso.
  const existentes = await sql`SELECT id FROM usuarios WHERE email = ${email} AND ativo = TRUE LIMIT 1`;
  if (existentes.length) {
    return erro(409, 'Este e-mail já está cadastrado.');
  }

  let papel = 'cliente';
  let criarMaster = false;
  let criadoPor = null;

  if (dados.papel === 'equipe') {
    const solicitante = await getUsuarioDaSessao(event);
    if (!solicitante || solicitante.papel !== 'equipe') {
      return erro(403, 'Apenas barbeiros podem criar contas de barbeiro.');
    }
    const querMaster = dados.master === true;

    if (solicitante.master) {
      if (querMaster && dados.confirmarRiscoMaster !== true) {
        // A tela mostra o aviso obrigatório antes; aqui o servidor também
        // exige, para ninguém criar um master chamando a API às cegas.
        return erro(400, 'Para criar um barbeiro master é preciso confirmar que você entendeu os riscos.');
      }
      criarMaster = querMaster;
    } else if (solicitante.pode_criar_barbeiros) {
      if (querMaster) return erro(403, 'Somente um barbeiro master pode criar outro master.');
    } else {
      return erro(403, 'Você ainda não tem permissão para criar barbeiros. Peça a um barbeiro master.');
    }
    papel = 'equipe';
    criadoPor = solicitante.id;
  } else {
    // Cadastro aberto (cliente): limita criação em massa por IP.
    const ip = ipDoCliente(event);
    if (await excedeuLimite(sql, `cadastro:${ip}`, 5, 60)) {
      return erro(429, 'Muitos cadastros deste dispositivo em pouco tempo. Tente novamente mais tarde.');
    }
  }

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  const [usuario] = await sql`
    INSERT INTO usuarios (nome, email, senha_hash, papel, avatar_url, master, criado_por)
    VALUES (${nome}, ${email}, ${senhaHash}, ${papel}, '/assets/img/avatar-exemplo.jpg', ${criarMaster}, ${criadoPor})
    RETURNING id, nome, email, papel, avatar_url, master
  `;
  if (papel !== 'equipe') await registrarUso(sql, `cadastro:${ipDoCliente(event)}`);

  // Best-effort: nunca deixa uma falha aqui derrubar o cadastro (que já
  // está gravado e utilizável no banco nesse ponto). Erros de envio (ou o
  // modo local, sem Resend configurado) só ficam registrados no log do
  // servidor — a pessoa que se cadastrou não vê e não é afetada.
  try {
    const tokenBruto = gerarTokenBruto();
    const tokenHash = hashToken(tokenBruto);
    const expiraEm = new Date(Date.now() + VALIDADE_TOKEN_HORAS * 3600 * 1000);
    await sql`
      INSERT INTO verificacoes_email (usuario_id, token_hash, expira_em)
      VALUES (${usuario.id}, ${tokenHash}, ${expiraEm.toISOString()})
    `;
    await enviarEmailVerificacao(event, usuario.email, usuario.nome, tokenBruto);
  } catch (e) {
    console.error('Falha ao enviar e-mail de confirmação (cadastro segue normalmente):', e.message);
  }

  // Login automático só quando é a própria pessoa se cadastrando. Quando
  // é a equipe criando a conta de um COLEGA (papel === 'equipe' só é
  // possível aqui porque quem chamou já está logado como equipe — ver
  // checagem acima), NÃO logamos essa sessão no navegador de quem criou:
  // isso trocaria a sessão de quem está logado (o criador) pela do colega
  // recém-criado, silenciosamente. O colega faz o próprio login depois,
  // com a senha que foi combinada entre os dois.
  let setCookie = null;
  if (papel !== 'equipe') {
    setCookie = await criarSessao(usuario.id);
  }

  return json(
    201,
    { usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, avatar_url: usuario.avatar_url, master: usuario.master } },
    setCookie ? { 'Set-Cookie': setCookie } : {}
  );
});
