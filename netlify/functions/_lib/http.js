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

/**
 * Lê um ID que pode chegar de duas formas diferentes:
 * (1) query string (`?id=123` ou o nome que for, ex. `usuarioId`) — o
 *     jeito "de sempre", e o único jeito que cada function já sabia ler;
 * (2) o último segmento do CAMINHO da URL (`/api/usuarios/123`) — o jeito
 *     que o front-end (`database/db.js`) sempre chamou essas rotas de
 *     fato, contando com um redirect do netlify.toml pra transformar
 *     isso na forma (1) antes de chegar na function.
 *
 * Em produção, essa transformação do redirect (placeholder de caminho
 * viando query string, ex. `to = ".../usuarios?id=:id"`) se mostrou
 * pouco confiável — as chamadas chegavam na function sem o parâmetro,
 * resultando no erro genérico "Informe o id/usuarioId..." mesmo com o ID
 * certinho na URL que o navegador pediu. `netlify.toml` foi ajustado pra
 * usar um splat de CAMINHO em vez de montar query string (mecanismo bem
 * mais simples e documentado do Netlify), mas esta function aceita as
 * duas formas — a atual e a antiga — pra nunca mais depender de um único
 * mecanismo de redirect funcionar perfeitamente. Só aceita o segmento do
 * caminho se ele for só dígitos (todo ID deste projeto é BIGSERIAL), pra
 * não confundir o nome da própria function (`/usuarios`, sem ID nenhum)
 * com um ID de verdade.
 */
function idDaRequisicao(event, nomeQuery = 'id') {
  const daQuery = event.queryStringParameters?.[nomeQuery];
  if (daQuery) return daQuery;
  const segmentos = (event.path || '').split('/').filter(Boolean);
  const ultimo = segmentos[segmentos.length - 1];
  return ultimo && /^\d+$/.test(ultimo) ? ultimo : null;
}

/**
 * Normaliza uma coluna DATE do Postgres pra sempre virar uma string limpa
 * "AAAA-MM-DD" na resposta da API — nunca um Date/timestamp completo.
 *
 * O driver do Neon pode devolver uma coluna DATE como objeto `Date` do
 * JavaScript; quando isso passa por `JSON.stringify` (dentro de json(),
 * acima), o `Date` vira automaticamente uma string ISO completa, tipo
 * "2026-09-25T00:00:00.000Z" — com hora e fuso que a coluna DATE nem
 * tem. O front-end esperava só a data ("2026-09-25"), e o "T00:00:00.000Z"
 * sobrando quebrava tanto a formatação exibida na tela (ex.:
 * "25T00:00:00.000Z/09/2026") quanto comparações de data usadas para
 * decidir o que é "hoje" ou "futuro x passado" — ver comentário em
 * assets/src/ui.js / formatarDataCurta(). Toda function que devolve uma
 * coluna DATE deve passar o valor por aqui antes de colocar na resposta.
 */
function paraDataISO(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) {
    // Coluna DATE não tem fuso — o driver sempre representa isso como
    // meia-noite UTC, então pegar os 10 primeiros caracteres do ISO em
    // UTC nunca desliza um dia pra trás/frente.
    return valor.toISOString().slice(0, 10);
  }
  return String(valor).slice(0, 10);
}

module.exports = { json, erro, metodoNaoPermitido, corpoJson, idDaRequisicao, paraDataISO };
