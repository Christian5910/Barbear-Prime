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

/**
 * Tamanho máximo aceito para o corpo de uma requisição JSON comum (o upload
 * tem limite próprio). Sem isso, alguém podia mandar vários MB de JSON para
 * cada chamada só para gastar CPU/memória da function.
 */
const LIMITE_CORPO_BYTES = 64 * 1024;

/**
 * Como corpoJson(), mas recusa corpos grandes demais. Devolve null se o
 * JSON for inválido OU grande demais (quem chama já trata null como 400).
 */
function corpoJsonLimitado(event, limite = LIMITE_CORPO_BYTES) {
  if (event.body && Buffer.byteLength(event.body, 'utf8') > limite) return null;
  return corpoJson(event);
}

/**
 * IP de quem chamou. O Netlify preenche `x-nf-client-connection-ip` com o
 * IP da conexão de verdade (o cliente não consegue forjar esse cabeçalho).
 * `x-forwarded-for` só entra como reserva (ex.: `netlify dev` local), porque
 * o primeiro item dele pode ser escrito pelo próprio cliente.
 */
function ipDoCliente(event) {
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',').pop().trim() ||
    'desconhecido'
  ).slice(0, 64);
}

/**
 * Defesa em profundidade contra CSRF: o cookie de sessão já é SameSite=Lax
 * (o navegador não o envia em POST/PUT/DELETE vindos de outro site), mas
 * também recusamos qualquer requisição que MUDA dados cujo cabeçalho Origin
 * aponte para outro site. Sem Origin (curl, apps) não há o que conferir.
 */
function origemPermitida(event) {
  const metodo = (event.httpMethod || 'GET').toUpperCase();
  if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return true;
  const h = event.headers || {};
  const origem = h.origin || h.Origin;
  if (!origem) return true;
  let hostOrigem;
  try {
    hostOrigem = new URL(origem).host;
  } catch (e) {
    return false; // "null" ou lixo
  }
  const hostsAceitos = [h['x-forwarded-host'], h.host].filter(Boolean);
  for (const url of [process.env.SITE_URL, process.env.URL]) {
    try { if (url) hostsAceitos.push(new URL(url).host); } catch (e) { /* ignora */ }
  }
  return hostsAceitos.includes(hostOrigem);
}

/** Envolve um handler: recusa origem estranha e converte exceção em 500 limpo. */
function comProtecao(handler) {
  return async (event, contexto) => {
    if (!origemPermitida(event)) return erro(403, 'Origem da requisição não permitida.');
    try {
      return await handler(event, contexto);
    } catch (e) {
      // Nunca devolve a mensagem crua do banco/driver ao cliente (pode
      // expor nome de tabela, coluna ou trecho da consulta).
      console.error('Erro não tratado na function:', e);
      return erro(500, 'Erro interno. Tente novamente em instantes.');
    }
  };
}

/** Escapa texto para colocar dentro de HTML (e-mails). */
function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Valida "AAAA-MM-DD" (e que a data existe) e "HH:MM". */
function ehDataISO(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function ehHoraHHMM(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

module.exports = {
  json, erro, metodoNaoPermitido, corpoJson, corpoJsonLimitado, idDaRequisicao, paraDataISO,
  ipDoCliente, origemPermitida, comProtecao, escaparHtml, ehDataISO, ehHoraHHMM, LIMITE_CORPO_BYTES,
};
