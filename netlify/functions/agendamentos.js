/**
 * /api/agendamentos
 *   GET  ?usuarioId=&barbeiroId=&status=   — lista agendamentos (requer sessão)
 *   POST                                    — cria um agendamento novo
 *
 * /api/agendamentos/:id  (roteado via querystring ?id=... pelo netlify.toml)
 *   PUT  { acao: 'remarcar', data, hora } | { acao: 'status', status }
 *
 * Regras de negócio replicadas de database/db.js (ver netlify/functions/_lib/horarios.js):
 *   - serviços com duração > 60min ocupam múltiplos horários em sequência;
 *   - cada barbeiro tem a própria agenda (conflito só é checado dentro do
 *     mesmo barbeiro_id);
 *   - preço e nome do serviço são "congelados" (snapshot) no momento da
 *     marcação ou remarcação — editar o catálogo depois não muda valores
 *     já marcados.
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');
const { slotsNecessarios, sequenciaValidaNoDia, horariosBloqueadosNoDia } = require('./_lib/horarios');

async function montarSnapshot(sql, servicoIds) {
  if (!servicoIds.length) return [];
  const linhas = await sql`
    SELECT id, nome, preco_centavos FROM servicos WHERE id = ANY(${servicoIds})
  `;
  return linhas.map(s => ({ id: s.id, nome: s.nome, preco_centavos: s.preco_centavos }));
}

async function horariosOcupadosNoDia(sql, data, barbeiroId, ignorarAgendamentoId = null) {
  const linhas = barbeiroId
    ? await sql`
        SELECT ah.hora::text AS hora
        FROM agendamento_horarios ah
        JOIN agendamentos a ON a.id = ah.agendamento_id
        WHERE a.data_servico = ${data}
          AND a.status <> 'cancelado'
          AND a.barbeiro_id = ${barbeiroId}
          AND (${ignorarAgendamentoId}::bigint IS NULL OR a.id <> ${ignorarAgendamentoId})
      `
    : await sql`
        SELECT ah.hora::text AS hora
        FROM agendamento_horarios ah
        JOIN agendamentos a ON a.id = ah.agendamento_id
        WHERE a.data_servico = ${data}
          AND a.status <> 'cancelado'
          AND (${ignorarAgendamentoId}::bigint IS NULL OR a.id <> ${ignorarAgendamentoId})
      `;
  return linhas.map(l => l.hora.slice(0, 5));
}

function montarAgendamentoApi(agendamento, servicos, horarios) {
  return {
    id: String(agendamento.id),
    usuarioId: agendamento.usuario_id ? String(agendamento.usuario_id) : null,
    usuarioNome: agendamento.cliente_nome,
    usuarioAvatar: agendamento.usuario_avatar_url || null,
    barbeiroId: agendamento.barbeiro_id ? String(agendamento.barbeiro_id) : null,
    data: agendamento.data_servico,
    hora: agendamento.hora_inicio.slice(0, 5),
    status: agendamento.status,
    servicoIds: servicos.map(s => String(s.servico_id)),
    servicosSnapshot: servicos.map(s => ({
      id: s.servico_id ? String(s.servico_id) : null,
      nome: s.nome_snapshot,
      preco: s.preco_centavos_snapshot / 100,
    })),
    horariosOcupados: horarios,
    criadoPelaEquipe: agendamento.criado_pela_equipe,
  };
}

exports.handler = async (event) => {
  const sql = getSql();
  const id = event.queryStringParameters?.id;

  const usuarioLogado = await getUsuarioDaSessao(event);
  if (!usuarioLogado) return erro(401, 'Entre na sua conta para continuar.');

  if (event.httpMethod === 'GET') {
    const { usuarioId, barbeiroId, status } = event.queryStringParameters || {};

    let linhas;
    if (usuarioLogado.papel === 'equipe') {
      // Barbeiro só vê a própria agenda (mais agendamentos antigos sem
      // barbeiro definido, para não "sumir" com histórico anterior).
      // O join com usuarios traz o avatar do cliente (usado como um
      // "dot" ao lado do agendamento na tela de confirmação).
      linhas = await sql`
        SELECT a.*, u.avatar_url AS usuario_avatar_url
        FROM agendamentos a
        LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE (a.barbeiro_id IS NULL OR a.barbeiro_id = ${usuarioLogado.id})
          AND (${status || null}::text IS NULL OR a.status = ${status || null})
        ORDER BY a.data_servico, a.hora_inicio
      `;
    } else {
      // Cliente só vê os próprios agendamentos.
      linhas = await sql`
        SELECT a.*, u.avatar_url AS usuario_avatar_url
        FROM agendamentos a
        LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.usuario_id = ${usuarioLogado.id}
          AND (${status || null}::text IS NULL OR a.status = ${status || null})
        ORDER BY a.data_servico, a.hora_inicio
      `;
    }

    const agendamentos = await Promise.all(linhas.map(async (a) => {
      const servicos = await sql`SELECT * FROM agendamento_servicos WHERE agendamento_id = ${a.id}`;
      const horarios = await sql`SELECT hora::text AS hora FROM agendamento_horarios WHERE agendamento_id = ${a.id}`;
      return montarAgendamentoApi(a, servicos, horarios.map(h => h.hora.slice(0, 5)));
    }));

    return json(200, { agendamentos });
  }

  if (event.httpMethod === 'POST') {
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const servicoIds = (dados.servicoIds || []).map(String);
    const data = dados.data;
    const hora = dados.hora;
    const barbeiroId = dados.barbeiroId ? Number(dados.barbeiroId) : null;
    // Nome do cliente: da sessão (agendamento normal) ou informado pela
    // equipe (agendamento manual para cliente sem conta).
    const clienteNome = usuarioLogado.papel === 'equipe' && dados.clienteNome
      ? String(dados.clienteNome).trim()
      : usuarioLogado.nome;
    const usuarioIdDono = usuarioLogado.papel === 'equipe' && dados.clienteNome ? null : usuarioLogado.id;

    if (!servicoIds.length || !data || !hora) {
      return erro(400, 'Selecione serviço, data e horário.');
    }
    // agendamentos.cliente_nome é VARCHAR(120) no banco — sem checar aqui,
    // um nome digitado grande demais pela equipe (agendamento manual pra
    // cliente sem conta) virava um erro 500 cru do Postgres em vez de uma
    // mensagem clara.
    if (clienteNome.length > 120) {
      return erro(400, 'Nome do cliente muito longo (máximo 120 caracteres).');
    }

    // IMPORTANTE (papéis/privilégios + lógica de negócio): quando quem está
    // criando é um cliente, barbeiroId vem direto do corpo da requisição —
    // ou seja, é o cliente quem diz qual barbeiro está escolhendo. Sem
    // conferir que esse id é mesmo de uma conta de equipe ativa, alguém
    // manipulando a chamada à API (fora da tela) podia mandar qualquer
    // número (o próprio id, o de outro cliente, um id que não existe...).
    // Isso não derrubava o sistema, mas quebrava duas coisas ao mesmo tempo:
    // (1) horariosOcupadosNoDia()/horariosBloqueadosNoDia() filtram por
    // barbeiro_id — um id "de mentira" nunca bate com agendamento nenhum,
    // então a checagem de conflito e de folga eram sempre ignoradas, dava
    // pra "ocupar" o mesmo horário quantas vezes quisesse; (2) como
    // nenhuma conta de equipe de verdade tem esse id, o agendamento nunca
    // aparecia na agenda de ninguém pra ser confirmado — ficava "pendente"
    // pra sempre, invisível pra equipe.
    let barbeiroIdFinal;
    if (usuarioLogado.papel === 'equipe') {
      barbeiroIdFinal = usuarioLogado.id;
    } else {
      if (!barbeiroId) return erro(400, 'Selecione um barbeiro.');
      const [barbeiroValido] = await sql`
        SELECT id FROM usuarios WHERE id = ${barbeiroId} AND papel = 'equipe' AND ativo = TRUE LIMIT 1
      `;
      if (!barbeiroValido) return erro(400, 'Barbeiro inválido.');
      barbeiroIdFinal = barbeiroId;
    }

    // Também exige que TODOS os serviços pedidos existam e estejam ativos
    // (não só "pelo menos um") — sem isso, pedir um serviço já removido do
    // catálogo (ex.: id antigo, digitado à mão na API) fazia o agendamento
    // ser criado silenciosamente com menos serviços do que o cliente achava
    // que tinha marcado, ou permitia marcar um serviço que a equipe já tinha
    // desativado (escondido do catálogo) de propósito.
    const servicoIdsUnicos = [...new Set(servicoIds)];
    const servicosCatalogo = await sql`
      SELECT id, duracao_min FROM servicos WHERE id = ANY(${servicoIdsUnicos}) AND ativo = TRUE
    `;
    if (servicosCatalogo.length !== servicoIdsUnicos.length) {
      return erro(400, 'Um ou mais serviços selecionados não estão mais disponíveis.');
    }

    const duracaoTotal = servicosCatalogo.reduce((soma, s) => soma + s.duracao_min, 0);
    const qtdSlots = slotsNecessarios(duracaoTotal);
    const sequencia = sequenciaValidaNoDia(data, hora, qtdSlots);
    if (!sequencia) {
      return erro(409, 'Esse horário não está disponível (fora do horário de funcionamento ou sem sequência livre suficiente).');
    }

    const ocupados = await horariosOcupadosNoDia(sql, data, barbeiroIdFinal);
    const bloqueados = await horariosBloqueadosNoDia(sql, data, barbeiroIdFinal);
    if (sequencia.some(h => ocupados.includes(h) || bloqueados.includes(h))) {
      return erro(409, 'Este horário já está ocupado ou o barbeiro está de folga nesse dia/horário.');
    }

    const snapshot = await montarSnapshot(sql, servicoIds);

    const [novoAgendamento] = await sql`
      INSERT INTO agendamentos (usuario_id, cliente_nome, barbeiro_id, data_servico, hora_inicio, status, criado_pela_equipe)
      VALUES (
        ${usuarioIdDono}, ${clienteNome}, ${barbeiroIdFinal}, ${data}, ${hora + ':00'},
        ${usuarioLogado.papel === 'equipe' ? 'confirmado' : 'pendente'},
        ${usuarioLogado.papel === 'equipe'}
      )
      RETURNING *
    `;

    for (const h of sequencia) {
      await sql`INSERT INTO agendamento_horarios (agendamento_id, hora) VALUES (${novoAgendamento.id}, ${h + ':00'})`;
    }
    for (const s of snapshot) {
      await sql`
        INSERT INTO agendamento_servicos (agendamento_id, servico_id, nome_snapshot, preco_centavos_snapshot)
        VALUES (${novoAgendamento.id}, ${s.id}, ${s.nome}, ${s.preco_centavos})
      `;
    }

    const servicosSalvos = await sql`SELECT * FROM agendamento_servicos WHERE agendamento_id = ${novoAgendamento.id}`;
    return json(201, { agendamento: montarAgendamentoApi(novoAgendamento, servicosSalvos, sequencia) });
  }

  if (event.httpMethod === 'PUT') {
    if (!id) return erro(400, 'Informe o id do agendamento na URL.');
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const atuais = await sql`SELECT * FROM agendamentos WHERE id = ${id} LIMIT 1`;
    if (!atuais.length) return erro(404, 'Agendamento não encontrado.');
    const atual = atuais[0];

    // String(...) nos dois lados: os ids vêm do Postgres (BIGINT), que
    // alguns drivers devolvem como string e outros como number — comparar
    // com === direto arriscaria um falso-negativo (usuário barrado da
    // própria conta) ou, pior, um falso-positivo se um dia um dos dois
    // lados virar número e o outro continuar string. Mesmo padrão já usado
    // em usuarios.js/preferencias-corte.js/notificacoes.js.
    const ehDono = atual.usuario_id != null && String(usuarioLogado.id) === String(atual.usuario_id);
    const ehBarbeiroResponsavel = usuarioLogado.papel === 'equipe' &&
      (!atual.barbeiro_id || String(atual.barbeiro_id) === String(usuarioLogado.id));
    if (!ehDono && !ehBarbeiroResponsavel) {
      return erro(403, 'Você não pode alterar este agendamento.');
    }

    if (dados.acao === 'status') {
      const statusValidos = ['pendente', 'confirmado', 'cancelado'];
      if (!statusValidos.includes(dados.status)) return erro(400, 'Status inválido.');

      // O cliente (dono) só pode cancelar o próprio agendamento — não pode
      // se auto-confirmar nem reabrir um agendamento cancelado. Só a
      // equipe pode definir "confirmado" ou voltar para "pendente".
      if (ehDono && !ehBarbeiroResponsavel && dados.status !== 'cancelado') {
        return erro(403, 'Você só pode cancelar o próprio agendamento.');
      }

      const [atualizado] = await sql`
        UPDATE agendamentos SET status = ${dados.status} WHERE id = ${id} RETURNING *
      `;
      const servicos = await sql`SELECT * FROM agendamento_servicos WHERE agendamento_id = ${id}`;
      const horarios = await sql`SELECT hora::text AS hora FROM agendamento_horarios WHERE agendamento_id = ${id}`;
      return json(200, { agendamento: montarAgendamentoApi(atualizado, servicos, horarios.map(h => h.hora.slice(0, 5))) });
    }

    if (dados.acao === 'remarcar') {
      // Mesma regra de "status" logo acima, aplicada aqui: remarcar sempre
      // volta o agendamento pra "pendente" (ver UPDATE abaixo), então sem
      // esta checagem um cliente conseguia contornar a restrição de "não
      // pode reabrir um agendamento cancelado" simplesmente chamando
      // remarcar em vez de status — o resultado prático seria o mesmo
      // (agendamento cancelado virando pendente de novo), só que por uma
      // porta que não tinha essa trava. A equipe continua podendo remarcar
      // um agendamento cancelado (ex.: cliente ligou pedindo pra reativar).
      if (ehDono && !ehBarbeiroResponsavel && atual.status === 'cancelado') {
        return erro(403, 'Este agendamento foi cancelado. Crie um novo agendamento.');
      }

      const novaData = dados.data;
      const novaHora = dados.hora;
      if (!novaData || !novaHora) return erro(400, 'Informe a nova data e horário.');

      const servicosAtuais = await sql`SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ${id}`;
      const servicoIds = servicosAtuais.map(s => s.servico_id).filter(Boolean);
      const servicosCatalogo = await sql`SELECT id, duracao_min FROM servicos WHERE id = ANY(${servicoIds})`;
      const duracaoTotal = servicosCatalogo.reduce((soma, s) => soma + s.duracao_min, 0) || 30;
      const qtdSlots = slotsNecessarios(duracaoTotal);
      const sequencia = sequenciaValidaNoDia(novaData, novaHora, qtdSlots);
      if (!sequencia) {
        return erro(409, 'Esse horário não está disponível (fora do horário de funcionamento ou sem sequência livre suficiente).');
      }

      const ocupados = await horariosOcupadosNoDia(sql, novaData, atual.barbeiro_id, id);
      const bloqueados = await horariosBloqueadosNoDia(sql, novaData, atual.barbeiro_id);
      if (sequencia.some(h => ocupados.includes(h) || bloqueados.includes(h))) {
        return erro(409, 'Este horário já está ocupado ou o barbeiro está de folga nesse dia/horário.');
      }

      // Remarcação atualiza o snapshot para o preço/nome ATUAL do
      // catálogo — diferente de uma edição simples, conta como nova marcação.
      const snapshotAtualizado = await montarSnapshot(sql, servicoIds);

      const [atualizado] = await sql`
        UPDATE agendamentos
        SET data_servico = ${novaData}, hora_inicio = ${novaHora + ':00'}, status = 'pendente'
        WHERE id = ${id}
        RETURNING *
      `;

      await sql`DELETE FROM agendamento_horarios WHERE agendamento_id = ${id}`;
      for (const h of sequencia) {
        await sql`INSERT INTO agendamento_horarios (agendamento_id, hora) VALUES (${id}, ${h + ':00'})`;
      }

      await sql`DELETE FROM agendamento_servicos WHERE agendamento_id = ${id}`;
      for (const s of snapshotAtualizado) {
        await sql`
          INSERT INTO agendamento_servicos (agendamento_id, servico_id, nome_snapshot, preco_centavos_snapshot)
          VALUES (${id}, ${s.id}, ${s.nome}, ${s.preco_centavos})
        `;
      }

      const servicosSalvos = await sql`SELECT * FROM agendamento_servicos WHERE agendamento_id = ${id}`;
      return json(200, { agendamento: montarAgendamentoApi(atualizado, servicosSalvos, sequencia) });
    }

    return erro(400, 'Ação inválida. Use "status" ou "remarcar".');
  }

  return metodoNaoPermitido(['GET', 'POST', 'PUT']);
};
