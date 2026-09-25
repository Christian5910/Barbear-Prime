/**
 * /api/usuarios/:id  (roteado via querystring ?id=... pelo netlify.toml)
 *   PUT    — atualiza nome/e-mail/senha/avatar do próprio usuário
 *   DELETE — exclui a própria conta
 *
 * Só o dono da conta pode alterar/excluir (sem exceção para equipe aqui —
 * cada um mexe só na própria conta, igual ao front-end local fazia).
 */
const bcrypt = require('bcryptjs');
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJsonLimitado: corpoJson, idDaRequisicao, comProtecao } = require('./_lib/http');
const { getUsuarioDaSessao, encerrarSessao, tokenHashDaRequisicao } = require('./_lib/sessao');
const { normalizarUrlImagem } = require('./_lib/urls');
const { excedeuLimite, registrarUso } = require('./_lib/limite');

const CUSTO_BCRYPT = 12;

// A URL de avatar só é aceita se for uma imagem hospedada pelo próprio site
// (ImageKit ou /assets/) — ver _lib/urls.js para o raciocínio completo.
// Em uso normal esse valor é a URL que o próprio /api/upload acabou de
// devolver; esta checagem existe para quem chamar a API direto.
function validarUrlImagem(valor) {
  if (valor === undefined) return undefined; // campo não enviado: não mexe
  return normalizarUrlImagem(valor, 'foto de perfil');
}

exports.handler = comProtecao(async (event) => {
  const id = idDaRequisicao(event);
  if (!id) return erro(400, 'Informe o id do usuário na URL.');

  const usuarioLogado = await getUsuarioDaSessao(event);
  if (!usuarioLogado || String(usuarioLogado.id) !== String(id)) {
    return erro(403, 'Você só pode alterar a própria conta.');
  }

  const sql = getSql();

  if (event.httpMethod === 'PUT') {
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const nome = dados.nome !== undefined ? String(dados.nome).trim() : usuarioLogado.nome;
    const email = dados.email !== undefined ? String(dados.email).trim().toLowerCase() : usuarioLogado.email;
    if (typeof dados.nome === 'object' && dados.nome !== null) return erro(400, 'Nome inválido.');

    if (!nome || !email) return erro(400, 'Nome e e-mail não podem ficar vazios.');
    // Mesmos limites de auth-cadastro.js (ver comentário lá) — usuarios.nome
    // e usuarios.email são VARCHAR(120)/VARCHAR(190) no banco.
    if (nome.length > 120) return erro(400, 'Nome muito longo (máximo 120 caracteres).');
    if (email.length > 190) return erro(400, 'E-mail muito longo (máximo 190 caracteres).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return erro(400, 'Informe um e-mail válido.');
    }

    if (email !== usuarioLogado.email) {
      const emEmUso = await sql`SELECT id FROM usuarios WHERE email = ${email} AND id <> ${id} AND ativo = TRUE LIMIT 1`;
      if (emEmUso.length) return erro(409, 'Este e-mail já está em uso.');
    }

    let senhaHash = null;
    if (dados.senha) {
      const novaSenha = String(dados.senha);
      if (novaSenha.length < 6) return erro(400, 'A senha deve ter pelo menos 6 caracteres.');
      // bcrypt só usa os primeiros 72 bytes e o custo cresce com o texto:
      // sem teto, uma "senha" de vários MB gastava CPU à toa.
      if (novaSenha.length > 128) return erro(400, 'A senha deve ter no máximo 128 caracteres.');
      senhaHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);
    }

    // Trocar senha ou e-mail exige a SENHA ATUAL. Sem isso, quem pegasse
    // uma sessão aberta (computador emprestado, celular sem bloqueio)
    // trocava a senha e o e-mail e ficava dono da conta para sempre.
    const trocaCredencial = Boolean(senhaHash) || email !== usuarioLogado.email;
    if (trocaCredencial) {
      const chaveTentativa = `senha-atual:${id}`;
      if (await excedeuLimite(sql, chaveTentativa, 5, 15)) {
        return erro(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
      }
      const [dono] = await sql`SELECT senha_hash FROM usuarios WHERE id = ${id} LIMIT 1`;
      const senhaAtual = String(dados.senhaAtual || '');
      let confere = false;
      if (senhaAtual && senhaAtual.length <= 128 && dono) {
        confere = await bcrypt.compare(senhaAtual, dono.senha_hash);
      }
      if (!confere) {
        await registrarUso(sql, chaveTentativa);
        return erro(403, 'Informe corretamente a sua senha atual para trocar a senha ou o e-mail.');
      }
    }

    let avatarUrl;
    try {
      avatarUrl = validarUrlImagem(dados.avatarUrl) ?? null;
    } catch (e) {
      return erro(400, e.message);
    }

    const [atualizado] = await sql`
      UPDATE usuarios
      SET
        nome = ${nome},
        email = ${email},
        senha_hash = COALESCE(${senhaHash}, senha_hash),
        avatar_url = COALESCE(${avatarUrl}, avatar_url)
      WHERE id = ${id}
      RETURNING id, nome, email, papel, avatar_url
    `;
    // Trocou a senha: derruba as OUTRAS sessões (outros aparelhos/navegadores),
    // mantendo só a atual. Quem estivesse com a senha antiga perde o acesso.
    if (senhaHash) {
      const atual = tokenHashDaRequisicao(event);
      await sql`DELETE FROM sessoes WHERE usuario_id = ${id} AND token_hash <> ${atual || ''}`;
    }
    return json(200, { usuario: atualizado });
  }

  if (event.httpMethod === 'DELETE') {
    // A conta master nunca pode ser excluída, sem exceção — nem por ela
    // mesma. Precisa sempre existir alguém que consiga convidar barbeiro
    // novo, editar endereço/serviços e trocar o banner do painel; sem essa
    // trava, a barbearia inteira ficaria sem ninguém com esse acesso.
    // (Com vários masters, só a master RAIZ é protegida; um master criado
    // depois pode excluir a própria conta. A raiz só sai direto no banco.)
    if (usuarioLogado.master_raiz) {
      return erro(409, 'A conta master principal não pode ser excluída.');
    }
    if (usuarioLogado.papel === 'equipe') {
      const [{ total }] = await sql`
        SELECT COUNT(*)::int AS total FROM usuarios WHERE papel = 'equipe' AND ativo = TRUE
      `;
      if (total <= 1) {
        return erro(409, 'Esta é a única conta de barbeiro ativa. Crie outra conta de equipe antes de excluir esta.');
      }
    }
    await sql`DELETE FROM usuarios WHERE id = ${id}`;
    const setCookie = await encerrarSessao(event);
    return json(200, { ok: true }, { 'Set-Cookie': setCookie });
  }

  return metodoNaoPermitido(['PUT', 'DELETE']);
});
