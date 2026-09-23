/**
 * Sessão via cookie httpOnly + token opaco guardado na tabela `sessoes`.
 * ============================================================================
 * Sem nenhum serviço de autenticação terceiro — é a mesma ideia de sempre:
 * um token aleatório grande o bastante para não ser adivinhado, guardado
 * como hash no banco (nunca em texto puro), com expiração. O navegador só
 * guarda o token em si, dentro de um cookie httpOnly (inacessível a
 * JavaScript no navegador, o que barra roubo via XSS).
 *
 * Variável de ambiente opcional:
 *   COOKIE_SECURE = "false" para testar em http://localhost sem HTTPS
 *                   (em produção no Netlify, sempre roda em HTTPS, então
 *                   deixe sem configurar — o padrão já é seguro).
 */
const crypto = require('crypto');
const { getSql } = require('./db');

const NOME_COOKIE = 'bp_sessao';
const DURACAO_SESSAO_HORAS = 24 * 30; // 30 dias

function gerarTokenBruto() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(tokenBruto) {
  return crypto.createHash('sha256').update(tokenBruto).digest('hex');
}

function montarCookie(tokenBruto) {
  const seguro = process.env.COOKIE_SECURE === 'false' ? '' : '; Secure';
  const maxAge = DURACAO_SESSAO_HORAS * 3600;
  return `${NOME_COOKIE}=${tokenBruto}; HttpOnly${seguro}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function montarCookieExpirado() {
  const seguro = process.env.COOKIE_SECURE === 'false' ? '' : '; Secure';
  return `${NOME_COOKIE}=; HttpOnly${seguro}; SameSite=Lax; Path=/; Max-Age=0`;
}

function lerTokenDoCookie(event) {
  const cabecalho = event.headers?.cookie || event.headers?.Cookie || '';
  const par = cabecalho.split(';').map(s => s.trim()).find(s => s.startsWith(`${NOME_COOKIE}=`));
  return par ? par.split('=')[1] : null;
}

/**
 * Cria uma sessão nova para o usuário (usada por login e cadastro) e
 * devolve o header Set-Cookie pronto para incluir na resposta HTTP.
 */
async function criarSessao(usuarioId) {
  const sql = getSql();
  const tokenBruto = gerarTokenBruto();
  const tokenHash = hashToken(tokenBruto);
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_HORAS * 3600 * 1000);

  await sql`
    INSERT INTO sessoes (usuario_id, token_hash, expira_em)
    VALUES (${usuarioId}, ${tokenHash}, ${expiraEm.toISOString()})
  `;

  return montarCookie(tokenBruto);
}

/**
 * Lê a sessão atual a partir do cookie da requisição. Devolve o usuário
 * (sem senha_hash) ou null se não houver sessão válida.
 */
async function getUsuarioDaSessao(event) {
  const tokenBruto = lerTokenDoCookie(event);
  if (!tokenBruto) return null;

  const sql = getSql();
  const tokenHash = hashToken(tokenBruto);
  const linhas = await sql`
    SELECT u.id, u.nome, u.email, u.papel, u.avatar_url, u.ativo, u.master
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ${tokenHash} AND s.expira_em > now() AND u.ativo = TRUE
    LIMIT 1
  `;
  return linhas[0] || null;
}

async function encerrarSessao(event) {
  const tokenBruto = lerTokenDoCookie(event);
  if (tokenBruto) {
    const sql = getSql();
    const tokenHash = hashToken(tokenBruto);
    await sql`DELETE FROM sessoes WHERE token_hash = ${tokenHash}`;
  }
  return montarCookieExpirado();
}

module.exports = {
  criarSessao,
  getUsuarioDaSessao,
  encerrarSessao,
  montarCookieExpirado,
};
