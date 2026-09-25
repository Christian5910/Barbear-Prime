/**
 * POST /api/auth/resetar-senha
 * Body: { token, novaSenha }
 *
 * Confere o hash do token contra recuperacoes_senha (existe, não expirou,
 * não foi usado ainda), grava o hash da nova senha e:
 *   - marca o token como usado (nunca some a linha — fica o rastro de
 *     quando a senha foi trocada, e também é o que impede o mesmo link de
 *     ser clicado duas vezes);
 *   - apaga TODAS as sessões ativas dessa conta — se a senha precisou ser
 *     redefinida (esquecida ou vazada), qualquer sessão que já estivesse
 *     aberta em outro aparelho é encerrada also, boa prática padrão depois
 *     de uma troca de senha;
 *   - marca email_verificado = TRUE: completar essa redefinição com um
 *     token que só existe porque chegou por e-mail já prova que a pessoa
 *     tem acesso a essa caixa de entrada, então aproveitamos pra destravar
 *     o login também, caso a conta ainda não tivesse confirmado o
 *     cadastro original.
 */
const bcrypt = require('bcryptjs');
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJsonLimitado: corpoJson, comProtecao } = require('./_lib/http');
const { hashToken } = require('./_lib/tokens');

const CUSTO_BCRYPT = 12;

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const dados = corpoJson(event);
  const token = String(dados?.token || '').trim();
  const novaSenha = String(dados?.novaSenha || '');

  if (!token) return erro(400, 'Token ausente.');
  if (novaSenha.length < 6) return erro(400, 'A nova senha deve ter pelo menos 6 caracteres.');
  if (novaSenha.length > 128) return erro(400, 'A nova senha deve ter no máximo 128 caracteres.');

  const sql = getSql();
  const tokenHash = hashToken(token);

  const [linha] = await sql`
    SELECT id, usuario_id, expira_em, usado_em FROM recuperacoes_senha
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (!linha) {
    return erro(400, 'Link inválido. Peça uma nova redefinição de senha.');
  }
  if (linha.usado_em) {
    return erro(400, 'Este link já foi usado. Peça uma nova redefinição de senha.');
  }
  if (new Date(linha.expira_em).getTime() < Date.now()) {
    return erro(400, 'Este link expirou. Peça uma nova redefinição de senha.');
  }

  const senhaHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);

  // Consome o token de forma ATÔMICA: se dois pedidos chegarem juntos com o
  // mesmo link, só um consegue marcar usado_em (o outro recebe 0 linhas).
  const consumido = await sql`
    UPDATE recuperacoes_senha SET usado_em = now()
    WHERE id = ${linha.id} AND usado_em IS NULL
    RETURNING id
  `;
  if (!consumido.length) {
    return erro(400, 'Este link já foi usado. Peça uma nova redefinição de senha.');
  }
  await sql`UPDATE usuarios SET senha_hash = ${senhaHash}, email_verificado = TRUE WHERE id = ${linha.usuario_id}`;
  // Qualquer outro token de redefinição pendente dessa conta também perde
  // a validade (não tem porque deixar mais de um link "vivo" depois que
  // um já funcionou).
  await sql`DELETE FROM recuperacoes_senha WHERE usuario_id = ${linha.usuario_id} AND id != ${linha.id}`;
  await sql`DELETE FROM sessoes WHERE usuario_id = ${linha.usuario_id}`;

  return json(200, { ok: true, mensagem: 'Senha redefinida! Você já pode entrar com a nova senha.' });
});
