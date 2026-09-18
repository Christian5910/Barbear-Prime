/**
 * POST /api/auth/logout
 */
const { json, metodoNaoPermitido } = require('./_lib/http');
const { encerrarSessao } = require('./_lib/sessao');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const setCookie = await encerrarSessao(event);
  return json(200, { ok: true }, { 'Set-Cookie': setCookie });
};
