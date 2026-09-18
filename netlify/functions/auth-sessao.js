/**
 * GET /api/auth/sessao
 * Devolve o usuário logado (a partir do cookie) ou { usuario: null }.
 */
const { json, metodoNaoPermitido } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return metodoNaoPermitido(['GET']);

  const usuario = await getUsuarioDaSessao(event);
  return json(200, { usuario: usuario || null });
};
