/**
 * POST /api/auth/login
 * Body: { email, senha }
 */
const bcrypt = require('bcryptjs');
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson } = require('./_lib/http');
const { criarSessao } = require('./_lib/sessao');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const dados = corpoJson(event);
  if (!dados) return erro(400, 'JSON inválido.');

  const email = String(dados.email || '').trim().toLowerCase();
  const senha = String(dados.senha || '');
  if (!email || !senha) return erro(400, 'Informe e-mail e senha.');

  const sql = getSql();
  const clienteIp = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;

  // Rate limit básico: bloqueia depois de muitas tentativas falhas
  // seguidas para o mesmo e-mail em uma janela curta. A tabela
  // tentativas_login já existia para isso (ver comentário no schema),
  // mas nada a consultava — qualquer quantidade de tentativas era aceita.
  const JANELA_MINUTOS = 15;
  const MAX_TENTATIVAS_FALHAS = 8;
  const [{ total: falhasRecentes }] = await sql`
    SELECT COUNT(*)::int AS total FROM tentativas_login
    WHERE email = ${email} AND sucesso = FALSE
      AND criado_em > now() - make_interval(mins => ${JANELA_MINUTOS})
  `;
  if (falhasRecentes >= MAX_TENTATIVAS_FALHAS) {
    return erro(429, `Muitas tentativas de login para este e-mail. Aguarde ${JANELA_MINUTOS} minutos e tente novamente.`);
  }

  const usuarios = await sql`
    SELECT id, nome, email, senha_hash, papel, avatar_url, email_verificado, master
    FROM usuarios
    WHERE email = ${email} AND ativo = TRUE
    LIMIT 1
  `;
  const usuario = usuarios[0];

  // Sempre roda o bcrypt.compare, mesmo quando o e-mail não existe
  // (comparando contra um hash fixo, que nunca vai bater com nada). Sem
  // isso, a resposta seria visivelmente mais rápida para e-mails que não
  // existem do que para e-mails existentes com senha errada, já que o
  // bcrypt é propositalmente lento — e essa diferença de tempo daria pra
  // usar pra descobrir quais e-mails têm conta, mesmo com a mensagem de
  // erro sendo genérica nos dois casos.
  const HASH_FICTICIO = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8lZ8O3s1qhCFuJ4cRi6XJ4YQCONA8O';
  let senhaValida = false;
  try {
    senhaValida = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FICTICIO);
  } catch (e) {
    senhaValida = false;
  }

  await sql`
    INSERT INTO tentativas_login (email, sucesso, ip)
    VALUES (${email}, ${senhaValida}, ${clienteIp})
  `;

  if (!usuario || !senhaValida) {
    return erro(401, 'Usuário ou senha inválidos.');
  }

  // Login NÃO depende de email_verificado — mesmo princípio da recuperação
  // de senha: a confirmação de e-mail é um recurso que existe e pode ser
  // usado (ver auth-verificar-email.js), mas não uma trava de acesso.
  // Motivo prático: sem domínio próprio configurado no Resend, o e-mail
  // de confirmação nunca chega de verdade pra um cliente real (só
  // aparece nos logs da function, que só o dono do site vê — ver
  // _lib/email.js) — bloquear o login nessa condição deixaria toda
  // conta nova permanentemente inutilizável em produção sem domínio.
  const setCookie = await criarSessao(usuario.id);
  const { senha_hash, email_verificado, ...usuarioPublico } = usuario;

  return json(200, { usuario: usuarioPublico }, { 'Set-Cookie': setCookie });
};
