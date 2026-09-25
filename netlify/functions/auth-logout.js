/**
 * POST /api/auth/logout
 */
const { json, metodoNaoPermitido, comProtecao } = require('./_lib/http');
const { encerrarSessao } = require('./_lib/sessao');

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const setCookie = await encerrarSessao(event);
  return json(200, { ok: true }, { 'Set-Cookie': setCookie });
});
