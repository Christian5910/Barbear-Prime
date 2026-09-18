/**
 * GET /api/horarios-disponiveis?data=YYYY-MM-DD&servicoIds=1,2&barbeiroId=123
 *
 * Devolve a lista de horários do dia com disponivel:true/false, já
 * considerando quantos slots os serviços escolhidos exigem (ver
 * netlify/functions/_lib/horarios.js) e a agenda do barbeiro selecionado
 * (ou de todos, se barbeiroId não for informado — compatibilidade).
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido } = require('./_lib/http');
const { slotsNecessarios, calcularDisponibilidade, horariosBloqueadosNoDia } = require('./_lib/horarios');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return metodoNaoPermitido(['GET']);

  const { data, servicoIds, barbeiroId } = event.queryStringParameters || {};
  if (!data) return erro(400, 'Informe a data (YYYY-MM-DD).');

  const sql = getSql();
  const idsServicos = (servicoIds || '').split(',').filter(Boolean);

  let duracaoTotal = 30;
  if (idsServicos.length) {
    // Mesmo filtro ativo=TRUE de agendamentos.js: um serviço desativado não
    // deve contar pra duração/slots necessários aqui (senão a tela de
    // disponibilidade mostraria vagas erradas pra um serviço que nem
    // aparece mais pro cliente escolher).
    const servicos = await sql`SELECT duracao_min FROM servicos WHERE id = ANY(${idsServicos}) AND ativo = TRUE`;
    if (servicos.length) {
      duracaoTotal = servicos.reduce((soma, s) => soma + s.duracao_min, 0);
    }
  }
  const qtdSlots = slotsNecessarios(duracaoTotal);

  const linhasOcupadas = barbeiroId
    ? await sql`
        SELECT ah.hora::text AS hora
        FROM agendamento_horarios ah
        JOIN agendamentos a ON a.id = ah.agendamento_id
        WHERE a.data_servico = ${data} AND a.status <> 'cancelado' AND a.barbeiro_id = ${barbeiroId}
      `
    : await sql`
        SELECT ah.hora::text AS hora
        FROM agendamento_horarios ah
        JOIN agendamentos a ON a.id = ah.agendamento_id
        WHERE a.data_servico = ${data} AND a.status <> 'cancelado'
      `;

  const horariosOcupados = linhasOcupadas.map(l => l.hora.slice(0, 5));
  const horariosBloqueados = await horariosBloqueadosNoDia(sql, data, barbeiroId);
  const horarios = calcularDisponibilidade(data, [...horariosOcupados, ...horariosBloqueados], qtdSlots);

  return json(200, { horarios, slotsNecessarios: qtdSlots });
};
