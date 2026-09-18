/* ============================================================================
   BARBEAR PRIME — Banco local temporario
   ============================================================================

   Camada unica de dados para prototipo local. Hoje usa localStorage; em deploy,
   mantenha os nomes dos metodos e troque o corpo por chamadas HTTP para a API.
   ============================================================================ */

(function criarBancoLocal() {
  const CHAVES = {
    usuarios: 'bp_usuarios',
    sessao: 'bp_sessao',
    agendamentos: 'bp_agendamentos',
    preferencias: 'bp_preferencias_corte',
    config: 'bp_config',
    servicos: 'bp_servicos',
    versao: 'bp_db_versao',
  };

  const VERSAO_ATUAL = '2026-08-31';

  const SERVICOS_PADRAO = [
    { id: '1', nome: 'Barba', preco: 20, duracaoMin: 30, descricao: 'Modelagem e alinhamento da barba com navalha/máquina, hidratação e finalização do contorno.' },
    { id: '2', nome: 'Corte e Barba', preco: 45, duracaoMin: 60, descricao: 'Combo completo: corte de cabelo + barba, com acabamento e finalização.' },
    { id: '3', nome: 'Corte Padrao', preco: 30, duracaoMin: 40, descricao: 'Corte de cabelo clássico, com máquina e tesoura, lavagem e finalização.' },
    { id: '4', nome: 'Degrade', preco: 35, duracaoMin: 45, descricao: 'Corte degradê (fade), com transição suave entre os comprimentos.' },
    { id: '5', nome: 'Pigmento', preco: 30, duracaoMin: 35, descricao: 'Aplicação de pigmento para disfarçar falhas ou uniformizar a cor.' },
    { id: '6', nome: 'Sobrancelha', preco: 20, duracaoMin: 20, descricao: 'Design e alinhamento de sobrancelha.' },
    { id: '7', nome: 'Reflexo', preco: 55, duracaoMin: 70, descricao: 'Aplicação de reflexo/mechas no cabelo.' },
    { id: '8', nome: 'Nevou', preco: 145, duracaoMin: 120, descricao: 'Descoloração completa (nevou), com tratamento pós-química.' },
  ];

  const HORARIOS_PADRAO = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '19:00'];

  function ler(chave, fallback) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : fallback;
    } catch (erro) {
      console.warn('Banco local: falha ao ler', chave, erro);
      return fallback;
    }
  }

  function salvar(chave, valor) {
    localStorage.setItem(chave, JSON.stringify(valor));
    return valor;
  }

  function hashSenha(senha) {
    return btoa(unescape(encodeURIComponent(String(senha))));
  }

  function compararSenha(senha, senhaHash) {
    return hashSenha(senha) === senhaHash || String(senha) === senhaHash;
  }

  function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function gerarId(lista, minimo) {
    const maior = lista.reduce((acc, item) => Math.max(acc, Number(item.id) || 0), minimo);
    return maior + 1;
  }

  function emitirToast(mensagem, tipo = 'sucesso') {
    window.dispatchEvent(new CustomEvent('bp:toast', { detail: { mensagem, tipo } }));
  }

  function usuarioPublico(usuario) {
    if (!usuario) return null;
    const { senhaHash, ...publico } = usuario;
    return publico;
  }

  function caminhoAsset(relativo) {
    const emSites = window.location.pathname.includes('/sites/') || window.location.pathname.includes('\\sites\\');
    return emSites ? `../${relativo}` : relativo;
  }

  function seedInicial() {
    const usuariosAtuais = ler(CHAVES.usuarios, []);
    if (usuariosAtuais.length) {
      if (!localStorage.getItem(CHAVES.versao)) localStorage.setItem(CHAVES.versao, VERSAO_ATUAL);
      if (!localStorage.getItem(CHAVES.config)) salvar(CHAVES.config, {});
      if (!ler(CHAVES.servicos, []).length) salvar(CHAVES.servicos, SERVICOS_PADRAO.slice());
      return;
    }

    const agora = new Date().toISOString();
    const avatar = caminhoAsset('assets/img/avatar-exemplo.jpg');
    const usuarios = [
      {
        id: 1001,
        nome: 'Joao Osvaldo',
        email: 'joao@yahoo.com',
        senhaHash: hashSenha('123456'),
        papel: 'cliente',
        avatar,
        criadoEm: agora,
        ativo: true,
      },
      {
        id: 1002,
        nome: 'Barbeiro Admin',
        email: 'equipe@barbearprime.com',
        senhaHash: hashSenha('admin123'),
        papel: 'equipe',
        avatar,
        criadoEm: agora,
        ativo: true,
      },
      {
        id: 1003,
        nome: 'Ana Silva',
        email: 'ana@email.com',
        senhaHash: hashSenha('senha123'),
        papel: 'cliente',
        avatar,
        criadoEm: agora,
        ativo: true,
      },
    ];

    function snapshotDe(...ids) {
      return ids.map(id => {
        const s = SERVICOS_PADRAO.find(item => item.id === id);
        return s ? { id: s.id, nome: s.nome, preco: s.preco } : null;
      }).filter(Boolean);
    }

    const agendamentos = [
      { id: 2001, usuarioId: 1001, usuarioNome: 'Joao Osvaldo', servicoIds: ['1', '3'], servicosSnapshot: snapshotDe('1', '3'), data: '2026-09-15', hora: '14:00', status: 'confirmado', criadoEm: agora },
      { id: 2002, usuarioId: 1001, usuarioNome: 'Joao Osvaldo', servicoIds: ['2'], servicosSnapshot: snapshotDe('2'), data: '2026-09-20', hora: '10:00', status: 'pendente', criadoEm: agora },
      { id: 2003, usuarioId: 1003, usuarioNome: 'Ana Silva', servicoIds: ['4', '5'], servicosSnapshot: snapshotDe('4', '5'), data: '2026-09-18', hora: '16:00', status: 'pendente', criadoEm: agora },
    ];

    const preferencias = {
      1001: {
        tamanho_cabelo: 'medio',
        tipo_degrade: 'navalhado',
        acabamento: 'arredondado',
        estilo_barba: 'longa_cheia',
        notas: 'Prefiro a nuca bem alinhada e o contorno da barba mais fechado.',
      },
      1003: {
        tamanho_cabelo: 'longo',
        tipo_degrade: 'sombreado',
        acabamento: 'natural',
        estilo_barba: 'feita_rasa',
        notas: 'Gosto de um visual mais natural.',
      },
    };

    salvar(CHAVES.usuarios, usuarios);
    salvar(CHAVES.agendamentos, agendamentos);
    salvar(CHAVES.preferencias, preferencias);
    salvar(CHAVES.config, {});
    salvar(CHAVES.servicos, SERVICOS_PADRAO.slice());
    localStorage.setItem(CHAVES.versao, VERSAO_ATUAL);
  }

  function getUsuarios() {
    return ler(CHAVES.usuarios, []);
  }

  /**
   * Lista de barbeiros disponíveis para seleção no agendamento: todo
   * usuário com papel 'equipe' e conta ativa, sem dados sensíveis (senha).
   */
  function getBarbeiros() {
    return getUsuarios()
      .filter(u => u.papel === 'equipe' && u.ativo !== false)
      .map(usuarioPublico);
  }

  function getBarbeiroPorId(id) {
    return getBarbeiros().find(b => Number(b.id) === Number(id)) || null;
  }

  function salvarUsuarios(usuarios) {
    return salvar(CHAVES.usuarios, usuarios);
  }

  function getSessao() {
    return ler(CHAVES.sessao, null);
  }

  function salvarSessao(usuario) {
    const sessao = {
      usuarioId: usuario.id,
      papel: usuario.papel,
      nome: usuario.nome,
      email: usuario.email,
      avatar: usuario.avatar || caminhoAsset('assets/img/avatar-exemplo.jpg'),
      logadoEm: new Date().toISOString(),
    };
    salvar(CHAVES.sessao, sessao);
    window.dispatchEvent(new CustomEvent('bp:sessao-alterada', { detail: sessao }));
    return sessao;
  }

  function encerrarSessao() {
    localStorage.removeItem(CHAVES.sessao);
    window.dispatchEvent(new CustomEvent('bp:sessao-alterada', { detail: null }));
  }

  function cadastrarUsuario(nome, email, senha, papel = 'cliente') {
    const usuarios = getUsuarios();
    const emailNormalizado = normalizarEmail(email);

    if (!nome || !emailNormalizado || !senha) {
      emitirToast('Preencha todos os campos obrigatórios.', 'erro');
      return false;
    }
    if (usuarios.some(usuario => normalizarEmail(usuario.email) === emailNormalizado && usuario.ativo !== false)) {
      emitirToast('Este e-mail já está cadastrado.', 'erro');
      return false;
    }

    const novo = {
      id: gerarId(usuarios, 1000),
      nome: String(nome).trim(),
      email: emailNormalizado,
      senhaHash: hashSenha(senha),
      papel: papel === 'equipe' ? 'equipe' : 'cliente',
      avatar: caminhoAsset('assets/img/avatar-exemplo.jpg'),
      criadoEm: new Date().toISOString(),
      ativo: true,
    };

    usuarios.push(novo);
    salvarUsuarios(usuarios);
    emitirToast('Conta criada com sucesso.', 'sucesso');
    return usuarioPublico(novo);
  }

  function login(email, senha) {
    const emailNormalizado = normalizarEmail(email);
    const usuario = getUsuarios().find(item => normalizarEmail(item.email) === emailNormalizado && item.ativo !== false);

    if (!usuario || !compararSenha(senha, usuario.senhaHash)) {
      emitirToast('Usuário ou senha inválidos.', 'erro');
      return null;
    }

    salvarSessao(usuario);
    emitirToast('Login realizado com sucesso.', 'sucesso');
    return usuarioPublico(usuario);
  }

  function atualizarPerfil(nome, email, senha, avatar) {
    const sessao = getSessao();
    if (!sessao) {
      emitirToast('Você precisa estar logado.', 'erro');
      return false;
    }

    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(usuario => Number(usuario.id) === Number(sessao.usuarioId));
    if (idx < 0) {
      emitirToast('Usuário não encontrado.', 'erro');
      return false;
    }

    const emailNormalizado = normalizarEmail(email);
    const emailEmUso = usuarios.some(usuario =>
      Number(usuario.id) !== Number(sessao.usuarioId) &&
      normalizarEmail(usuario.email) === emailNormalizado &&
      usuario.ativo !== false
    );
    if (emailEmUso) {
      emitirToast('Este e-mail já está em uso.', 'erro');
      return false;
    }

    usuarios[idx] = {
      ...usuarios[idx],
      nome: String(nome || usuarios[idx].nome).trim(),
      email: emailNormalizado || usuarios[idx].email,
      avatar: avatar || usuarios[idx].avatar,
      atualizadoEm: new Date().toISOString(),
    };
    if (senha) usuarios[idx].senhaHash = hashSenha(senha);

    salvarUsuarios(usuarios);
    salvarSessao(usuarios[idx]);
    emitirToast('Dados salvos com sucesso.', 'sucesso');
    return usuarioPublico(usuarios[idx]);
  }

  function excluirConta() {
    const sessao = getSessao();
    if (!sessao) return false;
    if (!confirm('Tem certeza que deseja excluir sua conta? Essa acao nao pode ser desfeita.')) return false;

    salvarUsuarios(getUsuarios().filter(usuario => Number(usuario.id) !== Number(sessao.usuarioId)));
    salvar(CHAVES.agendamentos, getAgendamentos().filter(item => Number(item.usuarioId) !== Number(sessao.usuarioId)));

    const preferencias = ler(CHAVES.preferencias, {});
    delete preferencias[sessao.usuarioId];
    salvar(CHAVES.preferencias, preferencias);

    encerrarSessao();
    emitirToast('Conta excluída.', 'sucesso');
    window.location.href = '../index.html';
    return true;
  }

  function getAgendamentos() {
    return ler(CHAVES.agendamentos, []);
  }

  function salvarAgendamentos(agendamentos) {
    return salvar(CHAVES.agendamentos, agendamentos);
  }

  function getServicos() {
    const salvos = ler(CHAVES.servicos, []);
    const lista = salvos.length ? salvos.slice() : SERVICOS_PADRAO.slice();
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  function getServicoPorId(id) {
    return getServicos().find(servico => servico.id === String(id)) || null;
  }

  function criarServico(dados) {
    const nome = String(dados?.nome || '').trim();
    const preco = Number(dados?.preco);
    const duracaoMin = Number(dados?.duracaoMin) || 30;
    const descricao = String(dados?.descricao || '').trim();

    if (!nome || !Number.isFinite(preco) || preco <= 0) {
      emitirToast('Preencha nome e um preço válido para o serviço.', 'erro');
      return false;
    }

    const servicos = getServicos();
    const novo = {
      id: String(gerarId(servicos, 8)),
      nome,
      preco,
      duracaoMin,
      descricao,
    };
    servicos.push(novo);
    salvar(CHAVES.servicos, servicos);
    emitirToast('Serviço criado.', 'sucesso');
    window.dispatchEvent(new CustomEvent('bp:servicos-alterados'));
    return novo;
  }

  function atualizarServico(id, dados) {
    const servicos = getServicos();
    const idx = servicos.findIndex(s => s.id === String(id));
    if (idx < 0) {
      emitirToast('Serviço não encontrado.', 'erro');
      return false;
    }

    const nome = String(dados?.nome ?? servicos[idx].nome).trim();
    const preco = dados?.preco !== undefined ? Number(dados.preco) : servicos[idx].preco;
    const duracaoMin = dados?.duracaoMin !== undefined ? (Number(dados.duracaoMin) || servicos[idx].duracaoMin) : servicos[idx].duracaoMin;
    const descricao = dados?.descricao !== undefined ? String(dados.descricao).trim() : (servicos[idx].descricao || '');

    if (!nome || !Number.isFinite(preco) || preco <= 0) {
      emitirToast('Preencha nome e um preço válido para o serviço.', 'erro');
      return false;
    }

    servicos[idx] = { ...servicos[idx], nome, preco, duracaoMin, descricao };
    salvar(CHAVES.servicos, servicos);
    emitirToast('Serviço atualizado. Agendamentos já marcados mantêm o valor original.', 'sucesso');
    window.dispatchEvent(new CustomEvent('bp:servicos-alterados'));
    return servicos[idx];
  }

  function excluirServico(id) {
    const servicos = getServicos();
    const existe = servicos.some(s => s.id === String(id));
    if (!existe) return false;

    salvar(CHAVES.servicos, servicos.filter(s => s.id !== String(id)));

    // Não afeta agendamentos já marcados (eles guardam servicosSnapshot),
    // mas remove o serviço excluído dos "Serviços em destaque", se estiver lá.
    const config = getConfig();
    if (Array.isArray(config.servicosDestaque) && config.servicosDestaque.includes(String(id))) {
      config.servicosDestaque = config.servicosDestaque.filter(item => item !== String(id));
      salvar(CHAVES.config, config);
      window.dispatchEvent(new CustomEvent('bp:destaque-alterado', { detail: config.servicosDestaque }));
    }

    emitirToast('Serviço removido.', 'sucesso');
    window.dispatchEvent(new CustomEvent('bp:servicos-alterados'));
    return true;
  }

  /**
   * Snapshot de nome/preço a gravar dentro do agendamento no momento da
   * criação/remarcação — garante que editar o catálogo depois não altera
   * o valor do que já foi marcado.
   */
  function snapshotServicos(servicoIds) {
    return (servicoIds || [])
      .map(id => getServicoPorId(id))
      .filter(Boolean)
      .map(s => ({ id: s.id, nome: s.nome, preco: s.preco }));
  }

  function calcularTotal(servicoIds) {
    return servicoIds.reduce((total, id) => total + (getServicoPorId(id)?.preco || 0), 0);
  }

  /**
   * Total de um agendamento já existente: usa o snapshot gravado no
   * momento da marcação (se existir) para não variar com edições
   * posteriores do catálogo. Sem snapshot (dados antigos), cai no preço
   * atual do catálogo.
   */
  function calcularTotalAgendamento(agendamento) {
    if (Array.isArray(agendamento?.servicosSnapshot) && agendamento.servicosSnapshot.length) {
      return agendamento.servicosSnapshot.reduce((total, s) => total + (Number(s.preco) || 0), 0);
    }
    return calcularTotal(agendamento?.servicoIds || []);
  }

  /**
   * Nomes dos serviços de um agendamento já existente: usa o snapshot
   * gravado no momento da marcação (se existir), pelo mesmo motivo acima.
   */
  function nomesServicosAgendamento(agendamento) {
    if (Array.isArray(agendamento?.servicosSnapshot) && agendamento.servicosSnapshot.length) {
      return agendamento.servicosSnapshot.map(s => s.nome).filter(Boolean);
    }
    return (agendamento?.servicoIds || []).map(id => getServicoPorId(id)?.nome).filter(Boolean);
  }

  function salvarAgendamentoLocal(servicoIds, data, hora, barbeiroId) {
    const sessao = getSessao();
    if (!sessao) {
      emitirToast('Entre na sua conta para confirmar o agendamento.', 'erro');
      window.location.href = 'login.html';
      return false;
    }

    const idsValidos = (servicoIds || []).map(String).filter(id => getServicoPorId(id));
    if (!idsValidos.length || !data || !hora) {
      emitirToast('Selecione serviço, data e horário.', 'erro');
      return false;
    }

    const barbeiro = barbeiroId ? getBarbeiroPorId(barbeiroId) : null;
    if (barbeiroId && !barbeiro) {
      emitirToast('Selecione um barbeiro válido.', 'erro');
      return false;
    }

    const qtdSlots = slotsNecessarios(idsValidos);
    const sequencia = sequenciaDeHorarios(hora, qtdSlots);
    if (!sequencia) {
      emitirToast('Esse horário não tem sequência livre suficiente para a duração do serviço.', 'erro');
      return false;
    }

    const ocupado = getAgendamentos().some(item =>
      item.data === data &&
      item.status !== 'cancelado' &&
      (!barbeiro || Number(item.barbeiroId) === Number(barbeiro.id)) &&
      (item.horariosOcupados || [item.hora]).some(h => sequencia.includes(h))
    );
    if (ocupado) {
      emitirToast('Este horário já está ocupado.', 'erro');
      return false;
    }

    const agendamentos = getAgendamentos();
    const novo = {
      id: gerarId(agendamentos, 2000),
      usuarioId: sessao.usuarioId,
      usuarioNome: sessao.nome,
      servicoIds: idsValidos,
      servicosSnapshot: snapshotServicos(idsValidos),
      data,
      hora,
      horariosOcupados: sequencia,
      barbeiroId: barbeiro?.id ?? null,
      barbeiroNome: barbeiro?.nome ?? null,
      status: 'pendente',
      criadoEm: new Date().toISOString(),
    };

    agendamentos.push(novo);
    salvarAgendamentos(agendamentos);
    sessionStorage.removeItem('bp-servicos-selecionados');
    emitirToast('Agendamento salvo.', 'sucesso');
    return novo;
  }

  function atualizarStatusAgendamentoLocal(id, status) {
    const agendamentos = getAgendamentos();
    const idx = agendamentos.findIndex(item => Number(item.id) === Number(id));
    if (idx < 0) return false;
    agendamentos[idx] = { ...agendamentos[idx], status, atualizadoEm: new Date().toISOString() };
    salvarAgendamentos(agendamentos);
    return agendamentos[idx];
  }

  function cancelarAgendamentoLocal(id) {
    const atualizado = atualizarStatusAgendamentoLocal(id, 'cancelado');
    if (atualizado) emitirToast('Agendamento cancelado.', 'sucesso');
    return atualizado;
  }

  function getAgendamentosDoUsuario(usuarioId) {
    return getAgendamentos()
      .filter(item => Number(item.usuarioId) === Number(usuarioId))
      .sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`));
  }

  function getProximoAgendamento(usuarioId) {
    const agora = new Date();
    return getAgendamentosDoUsuario(usuarioId).find(item => {
      if (item.status === 'cancelado') return false;
      return new Date(`${item.data}T${item.hora}:00`) >= agora;
    }) || null;
  }

  function getPreferenciasCorte(usuarioId) {
    const preferencias = ler(CHAVES.preferencias, {});
    return { ...(preferencias[usuarioId] || {}) };
  }

  function salvarPreferenciasCorte(usuarioId, preferenciasUsuario) {
    const preferencias = ler(CHAVES.preferencias, {});
    preferencias[usuarioId] = { ...(preferenciasUsuario || {}) };
    salvar(CHAVES.preferencias, preferencias);
    return preferencias[usuarioId];
  }

  /**
   * Quantos slots de horário (de 1h cada) um agendamento ocupa, a partir
   * da duração total dos serviços escolhidos. Serviços com duração maior
   * que 60min ocupam 2 (ou mais) horários em sequência — ex.: Reflexo e
   * Nevou, que passam de 60min, ocupam 2 slots.
   */
  function slotsNecessarios(servicoIds) {
    const duracaoTotal = (servicoIds || []).reduce((total, id) => total + (getServicoPorId(id)?.duracaoMin || 30), 0);
    return Math.max(1, Math.ceil(duracaoTotal / 60));
  }

  /**
   * Horários (em HORARIOS_PADRAO) que seguem imediatamente o horário dado,
   * ou seja, começam exatamente 1h depois — usado para saber se um
   * agendamento de 2+ slots pode começar em determinado horário sem cair
   * num intervalo maior (ex.: o buraco do almoço entre 11:00 e 13:00, ou
   * o intervalo entre 17:00 e 19:00).
   */
  function horaSeguinteImediata(hora) {
    const [h, m] = hora.split(':').map(Number);
    const minutosSeguinte = h * 60 + m + 60;
    const hh = String(Math.floor(minutosSeguinte / 60)).padStart(2, '0');
    const mm = String(minutosSeguinte % 60).padStart(2, '0');
    const candidata = `${hh}:${mm}`;
    return HORARIOS_PADRAO.includes(candidata) ? candidata : null;
  }

  /**
   * Lista de horários que um agendamento ocuparia a partir de horaInicio,
   * dado o número de slots necessários. Retorna null se não houver
   * sequência válida (ex.: pediria 2 slots começando às 11:00, mas o
   * próximo horário do dia é só às 13:00 — 2h de intervalo, não 1h).
   */
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

  function getHorariosDisponiveis(data, servicoIds, barbeiroId) {
    const ocupados = new Set(
      getAgendamentos()
        .filter(item =>
          item.data === data &&
          item.status !== 'cancelado' &&
          // Sem barbeiro informado (compat/legado): considera todos os
          // agendamentos do dia, como antes de existir múltiplos barbeiros.
          // Com barbeiroId informado: só bloqueia horários daquele barbeiro
          // — cada barbeiro tem a própria agenda.
          (!barbeiroId || Number(item.barbeiroId) === Number(barbeiroId))
        )
        .flatMap(item => item.horariosOcupados || [item.hora])
    );

    // Sábado (dia da semana 6): atendimento só até 15h.
    const diaSemana = data ? new Date(`${data}T00:00:00`).getDay() : null;
    const horariosDoDia = diaSemana === 6
      ? HORARIOS_PADRAO.filter(hora => hora <= '15:00')
      : HORARIOS_PADRAO;

    const qtdSlots = slotsNecessarios(servicoIds || []);

    return horariosDoDia.map(hora => {
      if (qtdSlots <= 1) {
        return { hora, disponivel: !ocupados.has(hora) };
      }
      const sequencia = sequenciaDeHorarios(hora, qtdSlots);
      const disponivel = Boolean(sequencia) &&
        sequencia.every(h => horariosDoDia.includes(h) && !ocupados.has(h));
      return { hora, disponivel };
    });
  }

  /* ---------------------------------------------------------------------
     Configuração do app (chave livre) — hoje usada para os "Serviços em
     destaque" mostrados na Home e no Painel do Barbeiro.
     --------------------------------------------------------------------- */
  function getConfig() {
    return ler(CHAVES.config, {});
  }

  function salvarConfig(config) {
    salvar(CHAVES.config, config || {});
    return config;
  }

  function getServicosDestaque() {
    const config = getConfig();
    const salvos = Array.isArray(config.servicosDestaque) ? config.servicosDestaque : [];
    const validos = salvos.filter(id => getServicoPorId(id));
    if (validos.length) return validos;
    // Sem configuração salva: os 4 primeiros do catálogo como padrão.
    return getServicos().slice(0, 4).map(s => s.id);
  }

  function salvarServicosDestaque(idsServicos) {
    const idsValidos = (idsServicos || [])
      .map(String)
      .filter(id => getServicoPorId(id))
      .slice(0, 4);
    const config = getConfig();
    config.servicosDestaque = idsValidos;
    salvar(CHAVES.config, config);
    window.dispatchEvent(new CustomEvent('bp:destaque-alterado', { detail: idsValidos }));
    emitirToast('Serviços em destaque atualizados.', 'sucesso');
    return idsValidos;
  }

  function getBannerBarbearia() {
    return getConfig().bannerBarbearia || null;
  }

  function salvarBannerBarbearia(base64) {
    const config = getConfig();
    config.bannerBarbearia = base64 || null;
    salvar(CHAVES.config, config);
    window.dispatchEvent(new CustomEvent('bp:banner-alterado', { detail: config.bannerBarbearia }));
    emitirToast('Foto de capa atualizada.', 'sucesso');
    return config.bannerBarbearia;
  }

  /* ---------------------------------------------------------------------
     Preferência de notificações de agendamento (lembretes no navegador).
     --------------------------------------------------------------------- */
  function getPreferenciaNotificacoes() {
    const config = getConfig();
    return config.notifAgendamentos !== false; // padrão: ligado
  }

  function salvarPreferenciaNotificacoes(ativado) {
    const config = getConfig();
    config.notifAgendamentos = !!ativado;
    salvar(CHAVES.config, config);
    return config.notifAgendamentos;
  }

  const SONS_NOTIFICACAO_VALIDOS = ['padrao', 'sino', 'navalha', 'personalizado', 'silencioso'];

  function getSomNotificacao() {
    const config = getConfig();
    return SONS_NOTIFICACAO_VALIDOS.includes(config.somNotificacao) ? config.somNotificacao : 'padrao';
  }

  function salvarSomNotificacao(som) {
    const valor = SONS_NOTIFICACAO_VALIDOS.includes(som) ? som : 'padrao';
    const config = getConfig();
    config.somNotificacao = valor;
    salvar(CHAVES.config, config);
    return valor;
  }

  const SOM_PERSONALIZADO_MAX_BYTES = 1 * 1024 * 1024; // 1MB

  function getSomPersonalizado() {
    const config = getConfig();
    return config.somPersonalizado || null; // { dataUrl, nomeArquivo }
  }

  function salvarSomPersonalizado(dataUrl, nomeArquivo) {
    const config = getConfig();
    config.somPersonalizado = dataUrl ? { dataUrl, nomeArquivo: nomeArquivo || 'som.mp3' } : null;
    salvar(CHAVES.config, config);
    return config.somPersonalizado;
  }

  /* ---------------------------------------------------------------------
     Agendamento criado pela equipe (painel do barbeiro): não exige conta
     de cliente — recebe o nome digitado na hora.
     --------------------------------------------------------------------- */
  function criarAgendamentoEquipe(nomeCliente, servicoIds, data, hora, status = 'confirmado') {
    const nome = String(nomeCliente || '').trim();
    const idsValidos = (servicoIds || []).map(String).filter(id => getServicoPorId(id));
    const sessao = getSessao();
    const barbeiroId = sessao?.papel === 'equipe' ? sessao.usuarioId : null;

    if (!nome || !idsValidos.length || !data || !hora) {
      emitirToast('Preencha cliente, serviço, data e horário.', 'erro');
      return false;
    }

    const qtdSlots = slotsNecessarios(idsValidos);
    const sequencia = sequenciaDeHorarios(hora, qtdSlots);
    if (!sequencia) {
      emitirToast('Esse horário não tem sequência livre suficiente para a duração do serviço.', 'erro');
      return false;
    }

    const ocupado = getAgendamentos().some(item =>
      item.data === data &&
      item.status !== 'cancelado' &&
      (!barbeiroId || Number(item.barbeiroId) === Number(barbeiroId)) &&
      (item.horariosOcupados || [item.hora]).some(h => sequencia.includes(h))
    );
    if (ocupado) {
      emitirToast('Este horário já está ocupado.', 'erro');
      return false;
    }

    const agendamentos = getAgendamentos();
    const novo = {
      id: gerarId(agendamentos, 2000),
      usuarioId: null,
      usuarioNome: nome,
      servicoIds: idsValidos,
      servicosSnapshot: snapshotServicos(idsValidos),
      data,
      hora,
      horariosOcupados: sequencia,
      barbeiroId: barbeiroId ?? null,
      barbeiroNome: sessao?.nome ?? null,
      status,
      criadoEm: new Date().toISOString(),
      criadoPelaEquipe: true,
    };

    agendamentos.push(novo);
    salvarAgendamentos(agendamentos);
    emitirToast('Agendamento criado.', 'sucesso');
    return novo;
  }

  /**
   * Remarca um agendamento existente para nova data/hora, respeitando a
   * mesma regra de conflito de horário usada na criação.
   */
  function remarcarAgendamentoLocal(id, novaData, novaHora) {
    if (!novaData || !novaHora) {
      emitirToast('Selecione a nova data e horário.', 'erro');
      return false;
    }
    const agendamentos = getAgendamentos();
    const idx = agendamentos.findIndex(item => Number(item.id) === Number(id));
    if (idx < 0) return false;

    const qtdSlots = slotsNecessarios(agendamentos[idx].servicoIds);
    const sequencia = sequenciaDeHorarios(novaHora, qtdSlots);
    if (!sequencia) {
      emitirToast('Esse horário não tem sequência livre suficiente para a duração do serviço.', 'erro');
      return false;
    }

    const barbeiroId = agendamentos[idx].barbeiroId;
    const ocupado = agendamentos.some((item, i) =>
      i !== idx &&
      item.data === novaData &&
      item.status !== 'cancelado' &&
      (!barbeiroId || Number(item.barbeiroId) === Number(barbeiroId)) &&
      (item.horariosOcupados || [item.hora]).some(h => sequencia.includes(h))
    );
    if (ocupado) {
      emitirToast('Este horário já está ocupado.', 'erro');
      return false;
    }

    agendamentos[idx] = {
      ...agendamentos[idx],
      data: novaData,
      hora: novaHora,
      horariosOcupados: sequencia,
      status: 'pendente',
      // Remarcação atualiza o valor/nome do serviço para o que está
      // no catálogo agora (diferente de uma edição só de horário no
      // mesmo agendamento — aqui contamos como "nova marcação").
      servicosSnapshot: snapshotServicos(agendamentos[idx].servicoIds),
      atualizadoEm: new Date().toISOString(),
    };
    salvarAgendamentos(agendamentos);
    emitirToast('Agendamento remarcado.', 'sucesso');
    return agendamentos[idx];
  }

  seedInicial();

  window.db = {
    chaves: CHAVES,
    servicosPadrao: SERVICOS_PADRAO,
    horariosPadrao: HORARIOS_PADRAO,
    getUsuarios,
    getBarbeiros,
    getBarbeiroPorId,
    salvarUsuarios,
    cadastrarUsuario,
    login,
    logout: encerrarSessao,
    encerrarSessao,
    getSessao,
    salvarSessao,
    usuarioLogado: () => Boolean(getSessao()),
    atualizarPerfil,
    excluirConta,
    getAgendamentos,
    salvarAgendamentos,
    getAgendamentosDoUsuario,
    getTodosAgendamentos: getAgendamentos,
    getProximoAgendamento,
    salvarAgendamentoLocal,
    cancelarAgendamentoLocal,
    atualizarStatusAgendamentoLocal,
    getPreferenciasCorte,
    salvarPreferenciasCorte,
    getServicos,
    getServicoPorId,
    criarServico,
    atualizarServico,
    excluirServico,
    calcularTotal,
    calcularTotalAgendamento,
    nomesServicosAgendamento,
    getHorariosDisponiveis,
    slotsNecessarios,
    getConfig,
    salvarConfig,
    getServicosDestaque,
    salvarServicosDestaque,
    getBannerBarbearia,
    salvarBannerBarbearia,
    getPreferenciaNotificacoes,
    salvarPreferenciaNotificacoes,
    getSomNotificacao,
    salvarSomNotificacao,
    getSomPersonalizado,
    salvarSomPersonalizado,
    criarAgendamentoEquipe,
    remarcarAgendamentoLocal,
  };
})();
