/**
 * Utilitários de resposta HTTP compartilhados por todas as functions.
 */

function json(statusCode, corpo, headersExtra = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headersExtra,
    },
    body: JSON.stringify(corpo),
  };
}

function erro(statusCode, mensagem) {
  return json(statusCode, { erro: mensagem });
}

function metodoNaoPermitido(metodosAceitos) {
  return json(405, { erro: `Método não permitido. Use: ${metodosAceitos.join(', ')}.` }, {
    Allow: metodosAceitos.join(', '),
  });
}

function corpoJson(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return null;
  }
}

module.exports = { json, erro, metodoNaoPermitido, corpoJson };
