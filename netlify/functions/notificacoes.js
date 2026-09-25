/**
 * /api/notificacoes/:usuarioId
 *   GET — devolve as preferências de notificação do usuário
 *   PUT — salva/atualiza (upsert)
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, idDaRequisicao, comProtecao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');
const { normalizarUrlImagem } = require('./_lib/urls');

const SONS_VALIDOS = ['padrao', 'sino', 'navalha', 'personalizado', 'silencioso'];

function paraApi(linha) {
  if (!linha) {
    return { notifAgendamentos: true, notifOfertas: false, notifEmailAgendamentos: false, somNotificacao: 'padrao', somPersonalizado: null };
  }
  return {
    notifAgendamentos: linha.notif_agendamentos,
    notifOfertas: linha.notif_ofertas,
    notifEmailAgendamentos: linha.notif_email_agendamentos,
    somNotificacao: linha.som_notificacao,
    somPersonalizado: linha.som_personalizado_url
      ? { url: linha.som_personalizado_url, nomeArquivo: linha.som_personalizado_nome }
      : null,
  };
}

exports.handler = comProtecao(async (event) => {
  const usuarioId = idDaRequisicao(event, 'usuarioId');
  if (!usuarioId) return erro(400, 'Informe o usuarioId.');

  const usuarioLogado = await getUsuarioDaSessao(event);
  if (!usuarioLogado || String(usuarioLogado.id) !== String(usuarioId)) {
    return erro(403, 'Sem permissão para acessar estas preferências.');
  }

  const sql = getSql();

  if (event.httpMethod === 'GET') {
    const linhas = await sql`SELECT * FROM preferencias_notificacao WHERE usuario_id = ${usuarioId} LIMIT 1`;
    return json(200, { preferencias: paraApi(linhas[0]) });
  }

  if (event.httpMethod === 'PUT') {
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const somNotificacao = SONS_VALIDOS.includes(dados.somNotificacao) ? dados.somNotificacao : 'padrao';

    // Mesmo cuidado do avatar (ver usuarios.js): som_personalizado_url é
    // uma URL escolhida por quem está logado. Aqui o risco é bem menor
    // (só o próprio usuário grava e só ele mesmo ouve o próprio som — não
    // é exibido pra mais ninguém), mas ainda assim vale normalizar/validar
    // como URL http(s) de verdade em vez de aceitar qualquer string, e
    // respeitar o limite de 190 caracteres de som_personalizado_nome
    // (VARCHAR(190) no banco) pra não virar um erro 500 cru.
    let somPersonalizadoUrl = null;
    const urlBruta = dados.somPersonalizado?.url;
    if (urlBruta) {
      // Só aceita áudio que o próprio site enviou (ImageKit) ou de /assets/.
      try {
        somPersonalizadoUrl = normalizarUrlImagem(urlBruta, 'som personalizado');
      } catch (e) {
        return erro(400, 'URL de som personalizado inválida.');
      }
    }
    const somPersonalizadoNome = dados.somPersonalizado?.nomeArquivo
      ? String(dados.somPersonalizado.nomeArquivo).slice(0, 190)
      : null;

    // Só faz sentido pra conta de equipe (é o barbeiro sendo avisado da
    // própria agenda) — ignora silenciosamente se marcado por uma conta
    // de cliente, em vez de gravar um estado que nunca vai ser usado.
    // Vale para barbeiros (aviso de novo pedido na agenda) e para clientes
    // (confirmação do próprio pedido).
    const notifEmailAgendamentos = Boolean(dados.notifEmailAgendamentos);

    const [salvo] = await sql`
      INSERT INTO preferencias_notificacao
        (usuario_id, notif_agendamentos, notif_ofertas, notif_email_agendamentos, som_notificacao, som_personalizado_url, som_personalizado_nome)
      VALUES (
        ${usuarioId},
        ${dados.notifAgendamentos !== false},
        ${Boolean(dados.notifOfertas)},
        ${notifEmailAgendamentos},
        ${somNotificacao},
        ${somPersonalizadoUrl},
        ${somPersonalizadoNome}
      )
      ON CONFLICT (usuario_id) DO UPDATE SET
        notif_agendamentos = EXCLUDED.notif_agendamentos,
        notif_ofertas = EXCLUDED.notif_ofertas,
        notif_email_agendamentos = EXCLUDED.notif_email_agendamentos,
        som_notificacao = EXCLUDED.som_notificacao,
        som_personalizado_url = EXCLUDED.som_personalizado_url,
        som_personalizado_nome = EXCLUDED.som_personalizado_nome
      RETURNING *
    `;
    return json(200, { preferencias: paraApi(salvo) });
  }

  return metodoNaoPermitido(['GET', 'PUT']);
});
