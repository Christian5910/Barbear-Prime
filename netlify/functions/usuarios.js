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
const { json, erro, metodoNaoPermitido, corpoJson, idDaRequisicao } = require('./_lib/http');
const { getUsuarioDaSessao, encerrarSessao } = require('./_lib/sessao');

const CUSTO_BCRYPT = 12;

// Valida/normaliza a URL de avatar antes de gravar. Em uso normal, esse
// valor sempre chega aqui como a URL que o próprio /api/upload acabou de
// devolver (depois de validar tipo/tamanho/assinatura do arquivo) — mas
// esta function não tem como saber disso, então NUNCA deve confiar
// cegamente numa string arbitrária vinda do corpo da requisição: qualquer
// pessoa logada poderia chamar PUT /api/usuarios/:id diretamente (sem
// passar pela tela) com um "avatarUrl" contendo aspas e um atributo tipo
// onerror="...", o que quebraria o `src="..."` no HTML de quem visse esse
// avatar depois (por exemplo, a equipe olhando a lista de agendamentos) e
// rodaria JavaScript arbitrário na sessão de quem estiver vendo. Exigir
// que seja uma URL http(s) bem formada e regravar a versão normalizada
// (via `new URL(...).href`) neutraliza isso: aspas/`<`/`>` inseridos no
// caminho ou na query são sempre percent-encoded pelo parser de URL, então
// não sobra como escapar de um atributo HTML mesmo se o front-end um dia
// esquecer de escapar esse valor também.
function validarUrlImagem(valor) {
  if (valor === undefined) return undefined; // campo não enviado — não mexe
  if (valor === null || valor === '') return null; // remoção explícita
  let url;
  try {
    url = new URL(String(valor));
  } catch (e) {
    throw new Error('URL de avatar inválida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL de avatar inválida.');
  }
  return url.href;
}

exports.handler = async (event) => {
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
      if (String(dados.senha).length < 6) return erro(400, 'A senha deve ter pelo menos 6 caracteres.');
      senhaHash = await bcrypt.hash(String(dados.senha), CUSTO_BCRYPT);
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
    return json(200, { usuario: atualizado });
  }

  if (event.httpMethod === 'DELETE') {
    // A conta master nunca pode ser excluída, sem exceção — nem por ela
    // mesma. Precisa sempre existir alguém que consiga convidar barbeiro
    // novo, editar endereço/serviços e trocar o banner do painel; sem essa
    // trava, a barbearia inteira ficaria sem ninguém com esse acesso.
    if (usuarioLogado.master) {
      return erro(409, 'A conta master não pode ser excluída.');
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
};
