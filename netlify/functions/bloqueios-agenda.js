/**
 * /api/bloqueios-agenda
 *   GET    ?barbeiroId=&data=     — lista bloqueios (uso público, pra calcular disponibilidade)
 *   POST   { data, hora? }        — cria um bloqueio na agenda do barbeiro logado (requer equipe)
 *   DELETE ?id=                   — remove um bloqueio (requer equipe, só o próprio)
 *
 * hora omitida/null = bloqueia o dia inteiro para esse barbeiro.
 * hora preenchida (HH:MM) = bloqueia só aquele horário específico.
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, paraDataISO } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');

function paraApi(linha) {
  return {
    id: String(linha.id),
    barbeiroId: String(linha.barbeiro_id),
    data: paraDataISO(linha.data),
    hora: linha.hora ? linha.hora.slice(0, 5) : null,
    motivo: linha.motivo || '',
  };
}

exports.handler = async (event) => {
  const sql = getSql();

  if (event.httpMethod === 'GET') {
    // Leitura é pública (sem exigir login) porque a tela de agendamento do
    // cliente precisa saber quais horários estão bloqueados antes mesmo de
    // ele entrar na conta — mesma lógica de /api/horarios-disponiveis.
    const { barbeiroId, data } = event.queryStringParameters || {};
    if (!barbeiroId) return erro(400, 'Informe o barbeiroId.');

    const linhas = data
      ? await sql`SELECT * FROM bloqueios_agenda WHERE barbeiro_id = ${barbeiroId} AND data = ${data} ORDER BY hora NULLS FIRST`
      : await sql`SELECT * FROM bloqueios_agenda WHERE barbeiro_id = ${barbeiroId} AND data >= CURRENT_DATE ORDER BY data, hora NULLS FIRST`;

    return json(200, { bloqueios: linhas.map(paraApi) });
  }

  const usuarioLogado = await getUsuarioDaSessao(event);
  if (!usuarioLogado || usuarioLogado.papel !== 'equipe') {
    return erro(403, 'Apenas a equipe pode gerenciar folgas e bloqueios de agenda.');
  }

  if (event.httpMethod === 'POST') {
    const dados = corpoJson(event);
    if (!dados || !dados.data) return erro(400, 'Informe a data do bloqueio.');
    const hora = dados.hora || null;
    const motivo = dados.motivo ? String(dados.motivo).trim().slice(0, 120) : null;

    // Dia inteiro (hora NULL): evita duplicar o mesmo bloqueio de dia
    // inteiro, já que o banco não impede múltiplos NULLs na mesma combinação.
    if (!hora) {
      const existente = await sql`
        SELECT id FROM bloqueios_agenda
        WHERE barbeiro_id = ${usuarioLogado.id} AND data = ${dados.data} AND hora IS NULL
        LIMIT 1
      `;
      if (existente.length) {
        const [atualizado] = await sql`
          UPDATE bloqueios_agenda SET motivo = ${motivo} WHERE id = ${existente[0].id} RETURNING *
        `;
        return json(200, { bloqueio: paraApi(atualizado) });
      }
    }

    const [criado] = await sql`
      INSERT INTO bloqueios_agenda (barbeiro_id, data, hora, motivo)
      VALUES (${usuarioLogado.id}, ${dados.data}, ${hora ? hora + ':00' : null}, ${motivo})
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    if (!criado) return erro(409, 'Esse horário já está marcado como bloqueado.');
    return json(201, { bloqueio: paraApi(criado) });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return erro(400, 'Informe o id do bloqueio.');

    const [removido] = await sql`
      DELETE FROM bloqueios_agenda
      WHERE id = ${id} AND barbeiro_id = ${usuarioLogado.id}
      RETURNING id
    `;
    if (!removido) return erro(404, 'Bloqueio não encontrado (ou não é seu).');
    return json(200, { ok: true });
  }

  return metodoNaoPermitido(['GET', 'POST', 'DELETE']);
};
