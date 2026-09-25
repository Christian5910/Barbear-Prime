/**
 * POST /api/auth/verificar-email
 * Body: { token }
 *
 * Chamado pela página sites/verificar-email.html, que lê o token da URL
 * (?token=...) do link recebido por e-mail. Confere o hash do token contra
 * verificacoes_email, marca a conta como email_verificado = TRUE e apaga
 * os tokens de verificação daquela conta (o que sobrou fica inútil de
 * qualquer forma, já que a conta já está verificada).
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, comProtecao } = require('./_lib/http');
const { hashToken } = require('./_lib/tokens');

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const dados = corpoJson(event);
  const token = String(dados?.token || '').trim();
  if (!token) return erro(400, 'Token ausente.');

  const sql = getSql();
  const tokenHash = hashToken(token);

  const [linha] = await sql`
    SELECT v.usuario_id, v.expira_em, u.email_verificado
    FROM verificacoes_email v
    JOIN usuarios u ON u.id = v.usuario_id
    WHERE v.token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (!linha) {
    return erro(400, 'Link inválido ou já usado. Isso não afeta sua conta — você pode continuar usando normalmente.');
  }
  if (new Date(linha.expira_em).getTime() < Date.now()) {
    return erro(400, 'Este link expirou. Isso não afeta sua conta — você pode continuar usando normalmente.');
  }

  // Já verificada (ex.: a pessoa clicou no link duas vezes) — trata como
  // sucesso em vez de erro, não tem porque travar isso.
  if (!linha.email_verificado) {
    await sql`UPDATE usuarios SET email_verificado = TRUE WHERE id = ${linha.usuario_id}`;
  }
  // Limpa todos os tokens de verificação dessa conta (o usado e qualquer
  // outro que tenha sobrado de um reenvio anterior).
  await sql`DELETE FROM verificacoes_email WHERE usuario_id = ${linha.usuario_id}`;

  return json(200, { ok: true, mensagem: 'E-mail confirmado!' });
});
