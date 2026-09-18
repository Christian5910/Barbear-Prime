/**
 * Regra de negócio de horários — portada de database/db.js (mesma lógica,
 * agora rodando no servidor, que é a fonte da verdade real).
 *
 * Serviços com duração > 60min ocupam mais de um horário em sequência
 * (ex.: Reflexo 70min, Nevou 120min). Um agendamento só pode começar num
 * horário se todos os seguintes necessários também estiverem livres E
 * formarem uma sequência de fato (sem cair no intervalo do almoço ou no
 * intervalo 17h→19h).
 *
 * A barbearia funciona de terça a sábado (fechada domingo e segunda), com
 * sábado tendo horário reduzido (até 15h). Essa regra de dia/horário
 * PRECISA ser a mesma tanto para listar disponibilidade quanto para
 * validar a criação/remarcação de um agendamento — daí horariosDoDia()
 * ser a única fonte disso, usada nos dois lugares.
 */

const HORARIOS_PADRAO = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '19:00'];

function slotsNecessarios(duracaoTotalMin) {
  return Math.max(1, Math.ceil(duracaoTotalMin / 60));
}

/**
 * Lista de horários possíveis num dia específico, já considerando os dias
 * em que a barbearia está fechada (domingo e segunda) e o horário
 * reduzido de sábado (até 15h). Fora desses casos, é a lista padrão.
 */
function horariosDoDia(dataISO) {
  const diaSemana = new Date(`${dataISO}T00:00:00`).getDay(); // 0=domingo ... 6=sábado
  if (diaSemana === 0 || diaSemana === 1) return []; // fechado aos domingos e segundas
  if (diaSemana === 6) return HORARIOS_PADRAO.filter(h => h <= '15:00'); // sábado: até 15h
  return HORARIOS_PADRAO;
}

function horaSeguinteImediata(hora) {
  const [h, m] = hora.split(':').map(Number);
  const minutosSeguinte = h * 60 + m + 60;
  const hh = String(Math.floor(minutosSeguinte / 60)).padStart(2, '0');
  const mm = String(minutosSeguinte % 60).padStart(2, '0');
  const candidata = `${hh}:${mm}`;
  return HORARIOS_PADRAO.includes(candidata) ? candidata : null;
}

function sequenciaDeHorarios(horaInicio, qtdSlots) {
  const sequencia = [horaInicio];
  let atual = horaInicio;
  for (let i = 1; i < qtdSlots; i++) {
    const proxima = horaSeguinteImediata(atual);
    if (!proxima) return null;
    sequencia.push(proxima);
    atual = proxima;
  }
  return sequencia;
}

/**
 * Combina sequenciaDeHorarios() com horariosDoDia(): a sequência só é
 * válida se TODOS os horários dela (não só o de início) couberem no que
 * está aberto naquele dia específico. Usada na criação e na remarcação de
 * agendamentos — sem isso, dava pra marcar um horário num domingo/segunda,
 * ou depois das 15h de sábado, direto pela API (a listagem de horários
 * disponíveis já escondia essas opções na tela, mas o servidor aceitava
 * do mesmo jeito se a requisição chegasse com esse horário).
 */
function sequenciaValidaNoDia(dataISO, horaInicio, qtdSlots) {
  const permitidosNoDia = horariosDoDia(dataISO);
  if (!permitidosNoDia.includes(horaInicio)) return null;
  const sequencia = sequenciaDeHorarios(horaInicio, qtdSlots);
  if (!sequencia) return null;
  return sequencia.every(h => permitidosNoDia.includes(h)) ? sequencia : null;
}

/**
 * Lista de horários do dia, cada um marcado como disponível ou não, dado
 * o conjunto de horários já ocupados (HH:MM) e quantos slots o novo
 * agendamento precisaria a partir de cada horário candidato.
 */
function calcularDisponibilidade(dataISO, horariosOcupados, qtdSlots) {
  const horariosDoDiaAtual = horariosDoDia(dataISO);
  const ocupadosSet = new Set(horariosOcupados);

  return horariosDoDiaAtual.map(hora => {
    if (qtdSlots <= 1) {
      return { hora, disponivel: !ocupadosSet.has(hora) };
    }
    const sequencia = sequenciaDeHorarios(hora, qtdSlots);
    const disponivel = Boolean(sequencia) &&
      sequencia.every(h => horariosDoDiaAtual.includes(h) && !ocupadosSet.has(h));
    return { hora, disponivel };
  });
}

/**
 * Horários bloqueados pelo próprio barbeiro (folga de dia inteiro ou de um
 * horário específico) numa data. Dia inteiro bloqueado é "expandido" para
 * todos os horários daquele dia — assim quem chama só precisa somar isso à
 * lista de horários já ocupados por agendamentos, sem tratar os dois casos
 * (dia inteiro vs. horário específico) separadamente.
 */
async function horariosBloqueadosNoDia(sql, dataISO, barbeiroId) {
  if (!barbeiroId) return [];
  const linhas = await sql`
    SELECT hora::text AS hora FROM bloqueios_agenda
    WHERE barbeiro_id = ${barbeiroId} AND data = ${dataISO}
  `;
  if (linhas.some(l => l.hora === null)) {
    return horariosDoDia(dataISO); // dia inteiro de folga
  }
  return linhas.map(l => l.hora.slice(0, 5));
}

module.exports = {
  HORARIOS_PADRAO,
  slotsNecessarios,
  horariosDoDia,
  sequenciaDeHorarios,
  sequenciaValidaNoDia,
  calcularDisponibilidade,
  horariosBloqueadosNoDia,
};
