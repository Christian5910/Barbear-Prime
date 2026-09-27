/* ============================================================================
   BARBEAR PRIME — Interações de UI (somente interface)
   ============================================================================

   Este arquivo contém apenas funções de interface e interação com o usuário.
   Toda a lógica de persistência (localStorage) está em database/db.js.

   Dependência: database/db.js deve ser carregado antes deste script.
   ============================================================================ */

/* ==========================================================================
   REDE DE SEGURANÇA — revela a navegação mesmo se algo travar
   ==========================================================================
   padronizarMenus() (mais abaixo) marca <html class="nav-pronta"> quando
   termina de montar o menu certo pra sessão — até lá, o CSS mantém o menu
   invisível de propósito (ver "Anti-flicker da navegação" em style.css),
   pra nunca mostrar o menu errado nem por um instante. Mas se ALGO travar
   antes disso (uma falha de rede ao confirmar a sessão, um erro
   inesperado em outra parte da inicialização), o menu não pode ficar
   invisível pra sempre — pior que o pisca original seria não ter
   navegação nenhuma. Roda fora do DOMContentLoaded, então dispara mesmo
   que o resto da inicialização nunca chegue a terminar.
   ========================================================================== */
setTimeout(() => document.documentElement.classList.add('nav-pronta'), 2500);

/* ==========================================================================
   SERVICE WORKER — Cache de arquivos (HTML/CSS/JS/imagens) para uso offline
   ==========================================================================
   Registrado o quanto antes, fora do DOMContentLoaded, pra começar a
   cachear em segundo plano assim que possível. sw.js fica na raiz do
   projeto de propósito (não dentro de sites/) — isso dá a ele escopo
   sobre o site inteiro, incluindo as páginas em sites/.
   ========================================================================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const caminhoSw = window.location.pathname.includes('/sites/') ? '../sw.js' : 'sw.js';
    navigator.serviceWorker.register(caminhoSw).catch(() => {
      // Falha ao registrar (ex.: navegador sem suporte real, ambiente de
      // desenvolvimento sem HTTPS) — o site continua funcionando
      // normalmente online, só sem o reforço de cache offline.
    });
  });
}

/* ==========================================================================
   NOTIFICAÇÕES — Lembretes de agendamento (Web Notifications API)
   ==========================================================================
   Funciona enquanto o app estiver aberto no navegador (sem service worker
   nem push server, é feito com setTimeout/setInterval local).

   Cliente: dois avisos por agendamento confirmado/pendente —
     1) na manhã do dia do corte, às 08:00 (exatamente 1h antes do
        primeiro horário possível do dia, que é 09:00);
     2) 1 hora antes do horário marcado.

   Equipe (barbeiro): três avisos —
     1) resumo às 08:00 com quantos agendamentos tem no dia;
     2) aviso quando um cliente cria um novo agendamento (pendente de
        confirmação) — verificado por sondagem periódica (ver
        agendarNotificacoesBarbeiro), já que não há push server;
     3) aviso quando um agendamento é desmarcado — mesma sondagem.
   ========================================================================== */
const bpNotificacoes = { timers: [] };
const bpMonitorBarbeiro = { intervalo: null, snapshot: null };

function bpNotificacoesSuportadas() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function bpDispararNotificacao(titulo, corpo) {
  if (!bpNotificacoesSuportadas() || Notification.permission !== 'granted') return;
  try {
    new Notification(titulo, { body: corpo, icon: resolverAsset('assets/img/icon-192.png'), tag: `bp-${titulo}-${corpo}` });
    bpTocarSomNotificacao();
  } catch (e) {
    // Ambiente sem suporte real a notificações (ex.: alguns webviews) — ignora silenciosamente.
  }
}

/**
 * Como bpDispararNotificacao(), mas com botão de ação e destino de clique
 * — usa registration.showNotification() (Service Worker) em vez do
 * construtor simples `new Notification()`, porque só a versão via Service
 * Worker suporta `actions` (botões dentro da notificação) e continua
 * conseguindo reagir ao clique mesmo com a aba fechada. Cai pro jeito
 * simples (sem botão, só abre a página ao clicar) se o Service Worker não
 * estiver disponível.
 *
 * @param {{agendamentoId?: string, url?: string, acoes?: Array}} opcoes
 *   `url`: página aberta/focada ao clicar (relativa à raiz do site).
 *   `agendamentoId` + uma ação com `action: 'confirmar'`: processado em
 *   sw.js (evento notificationclick) pra confirmar o agendamento direto
 *   dali, sem precisar abrir o app.
 */
async function bpDispararNotificacaoAcoes(titulo, corpo, opcoes = {}) {
  if (!bpNotificacoesSuportadas() || Notification.permission !== 'granted') return;
  const { agendamentoId, url, acoes } = opcoes;
  try {
    if ('serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.ready;
      await registro.showNotification(titulo, {
        body: corpo,
        icon: resolverAsset('assets/img/icon-192.png'),
        tag: `bp-${titulo}-${corpo}`,
        data: { agendamentoId, url },
        actions: acoes || [],
      });
      bpTocarSomNotificacao();
      return;
    }
  } catch (e) {
    // Cai pro fallback simples abaixo (sem Service Worker disponível, ou
    // showNotification falhou por outro motivo).
  }
  bpDispararNotificacao(titulo, corpo);
}

function bpLimparLembretesAgendados() {
  bpNotificacoes.timers.forEach(clearTimeout);
  bpNotificacoes.timers = [];
}

/**
 * Ponto de entrada único: decide se agenda os lembretes de cliente ou os
 * de equipe, conforme o papel da sessão atual. Chamado tanto ao carregar
 * qualquer página (se já há sessão) quanto logo depois de ativar as
 * notificações pela primeira vez.
 */
async function bpAgendarNotificacoesConformePapel() {
  const sessao = await window.db?.getSessao?.();
  if (!sessao) return;
  if (sessao.papel === 'equipe') {
    agendarNotificacoesBarbeiro();
  } else {
    agendarLembretesDeAgendamento();
  }
}

/**
 * Agenda (via setTimeout) os lembretes de todos os agendamentos futuros e
 * confirmados/pendentes do usuário logado. Deve ser chamada de novo sempre
 * que a lista de agendamentos do usuário puder ter mudado.
 */
async function agendarLembretesDeAgendamento() {
  if (!bpNotificacoesSuportadas() || Notification.permission !== 'granted') return;
  if (!window.db?.getPreferenciaNotificacoes) return;
  const notificacoesAtivadas = await window.db.getPreferenciaNotificacoes();
  if (!notificacoesAtivadas) return;

  const sessao = await window.db.getSessao?.();
  if (!sessao) return;

  bpLimparLembretesAgendados();

  const LIMITE_MS = 2 ** 31 - 1; // setTimeout não suporta atrasos maiores que ~24.8 dias
  const agora = Date.now();

  const agendamentos = await window.db.getAgendamentosDoUsuario(sessao.usuarioId);
  const futuros = agendamentos.filter(item => item.status !== 'cancelado');

  for (const item of futuros) {
    const nomes = await nomesServicosDoAgendamento(item);
    const horarioCorte = new Date(`${item.data}T${item.hora}:00`);
    if (Number.isNaN(horarioCorte.getTime())) continue;

    // Lembrete no dia, às 08:00 — 1h antes do primeiro horário possível (09:00).
    const noDia = new Date(horarioCorte);
    noDia.setHours(8, 0, 0, 0);
    const esperaNoDia = noDia.getTime() - agora;
    if (esperaNoDia > 0 && esperaNoDia < LIMITE_MS) {
      const id = setTimeout(() => {
        bpDispararNotificacao(
          'Hoje tem corte marcado! ✂️',
          `${nomes} às ${item.hora} na Barbear Prime.`
        );
      }, esperaNoDia);
      bpNotificacoes.timers.push(id);
    }

    // Lembrete 1h antes do horário.
    const umaHoraAntes = horarioCorte.getTime() - 60 * 60 * 1000;
    const esperaUmaHora = umaHoraAntes - agora;
    if (esperaUmaHora > 0 && esperaUmaHora < LIMITE_MS) {
      const id = setTimeout(() => {
        bpDispararNotificacao(
          'Seu horário é daqui a 1 hora',
          `${nomes} às ${item.hora} na Barbear Prime.`
        );
      }, esperaUmaHora);
      bpNotificacoes.timers.push(id);
    }
  }
}

/**
 * Notificações do lado da equipe (barbeiro):
 *  1) resumo às 08:00 com quantos agendamentos existem no dia;
 *  2) sondagem periódica pra avisar sobre agendamentos novos (pendentes de
 *     confirmação) e agendamentos desmarcados.
 *
 * Não existe push server neste projeto (ver nota no topo do arquivo), então
 * o aviso "em tempo real" de novo agendamento/cancelamento é aproximado por
 * sondagem: enquanto o barbeiro estiver com alguma página aberta e
 * logado, a cada intervalo comparamos o estado atual da agenda com o
 * último estado visto e notificamos só as diferenças novas.
 */
async function agendarNotificacoesBarbeiro() {
  if (!bpNotificacoesSuportadas() || Notification.permission !== 'granted') return;
  if (!window.db?.getPreferenciaNotificacoes) return;
  const notificacoesAtivadas = await window.db.getPreferenciaNotificacoes();
  if (!notificacoesAtivadas) return;

  const sessao = await window.db.getSessao?.();
  if (!sessao || sessao.papel !== 'equipe') return;

  bpLimparLembretesAgendados();
  bpAgendarResumoDiarioBarbeiro(sessao);
  await bpIniciarMonitorAgendaBarbeiro(sessao);
}

function bpAgendarResumoDiarioBarbeiro(sessao) {
  const LIMITE_MS = 2 ** 31 - 1;
  const agora = new Date();
  const resumoHoje = new Date();
  resumoHoje.setHours(8, 0, 0, 0); // mesmo horário do lembrete do cliente: 1h antes do primeiro horário possível (09:00)
  const espera = resumoHoje.getTime() - agora.getTime();
  if (espera <= 0 || espera >= LIMITE_MS) return; // já passou das 8h hoje — só volta a agendar no próximo carregamento de página

  const id = setTimeout(async () => {
    const hojeISO = formatarISO(new Date());
    const todos = await window.db.getTodosAgendamentos();
    const doDia = todos.filter(item =>
      item.data === hojeISO && item.status !== 'cancelado' &&
      (!item.barbeiroId || Number(item.barbeiroId) === Number(sessao.usuarioId))
    );
    if (!doDia.length) return; // sem agendamento nenhum hoje — não incomoda com notificação vazia
    bpDispararNotificacao(
      'Resumo do seu dia ✂️',
      `Você tem ${doDia.length} agendamento${doDia.length > 1 ? 's' : ''} hoje na Barbear Prime.`
    );
  }, espera);
  bpNotificacoes.timers.push(id);
}

async function bpIniciarMonitorAgendaBarbeiro(sessao) {
  const INTERVALO_MS = 60 * 1000; // sonda a cada 1 minuto

  async function montarSnapshotAtual() {
    const todos = await window.db.getTodosAgendamentos();
    const meus = todos.filter(item => !item.barbeiroId || Number(item.barbeiroId) === Number(sessao.usuarioId));
    const mapa = new Map();
    meus.forEach(item => mapa.set(String(item.id), item.status));
    return mapa;
  }

  async function verificarMudancas() {
    const atual = await montarSnapshotAtual();
    const anterior = bpMonitorBarbeiro.snapshot;
    if (anterior) {
      for (const [id, status] of atual) {
        const statusAnterior = anterior.get(id);
        if (status === 'pendente' && statusAnterior !== 'pendente') {
          bpDispararNotificacaoAcoes(
            'Novo agendamento! 📅',
            statusAnterior === undefined
              ? 'Um cliente marcou um horário e está aguardando confirmação.'
              : 'Um agendamento foi remarcado e está aguardando confirmação novamente.',
            {
              agendamentoId: id,
              // Caminho absoluto a partir da raiz (não rota(), que monta
              // caminho relativo à página atual) — o Service Worker
              // resolve isso a partir de self.location.origin, não de
              // onde esta notificação foi disparada, então precisa ser
              // inequívoco independente da página aberta no momento.
              url: '/sites/agendamentos.html',
              acoes: [{ action: 'confirmar', title: 'Confirmar' }],
            }
          );
        } else if (statusAnterior && statusAnterior !== 'cancelado' && status === 'cancelado') {
          bpDispararNotificacao('Agendamento desmarcado', 'Um horário da sua agenda foi cancelado.');
        }
      }
    }
    bpMonitorBarbeiro.snapshot = atual;
  }

  // A primeira leitura só define a linha de base (não notifica nada), pra
  // não disparar um monte de "novo agendamento" pra cada item que já
  // existia antes de abrir a página.
  bpMonitorBarbeiro.snapshot = await montarSnapshotAtual();

  clearInterval(bpMonitorBarbeiro.intervalo);
  bpMonitorBarbeiro.intervalo = setInterval(verificarMudancas, INTERVALO_MS);
}

/**
 * Atualiza a linha de base do monitor imediatamente após uma ação que o
 * PRÓPRIO barbeiro fez nesta aba (confirmar, desmarcar, remarcar, criar) —
 * sem isso, a próxima sondagem veria essa mudança como "nova" e notificaria
 * o barbeiro sobre a própria ação dele mesmo.
 */
function bpSincronizarMonitorAposAcaoLocal(id, novoStatus) {
  if (bpMonitorBarbeiro.snapshot) {
    bpMonitorBarbeiro.snapshot.set(String(id), novoStatus);
  }
}

/**
 * Liga/desliga o recurso de notificações: solicita permissão do navegador
 * quando necessário e persiste a preferência do usuário.
 */
async function bpAtivarNotificacoes() {
  if (!bpNotificacoesSuportadas()) {
    mostrarToast('Seu navegador não tem suporte a notificações.', 'erro');
    return false;
  }
  let permissao = Notification.permission;
  if (permissao === 'default') {
    permissao = await Notification.requestPermission();
  }
  if (permissao !== 'granted') {
    mostrarToast('Permissão de notificação negada pelo navegador.', 'erro');
    return false;
  }
  await window.db.salvarPreferenciaNotificacoes(true);
  bpAgendarNotificacoesConformePapel();
  return true;
}

async function bpDesativarNotificacoes() {
  await window.db.salvarPreferenciaNotificacoes(false);
  bpLimparLembretesAgendados();
}

function iniciarToggleNotificacoes() {
  const toggle = document.getElementById('notifAgendamentos');
  if (!toggle || !window.db) return;

  window.db.getPreferenciaNotificacoes().then(ativado => {
    toggle.checked = ativado && (!bpNotificacoesSuportadas() || Notification.permission === 'granted');
  });

  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      const ok = await bpAtivarNotificacoes();
      toggle.checked = ok;
    } else {
      await bpDesativarNotificacoes();
      const modalEl = document.getElementById('modalNotifAgendamentosInfo');
      if (modalEl && window.bootstrap) new window.bootstrap.Modal(modalEl).show();
    }
  });
}

/**
 * Toggle "Novidades e Ofertas": preferência simples, salva no servidor por
 * usuário. Não dispara notificações reais (não há um servidor para
 * enviá-las), mas mostra um popup explicativo ao ativar, como pedido.
 */
function iniciarToggleOfertas() {
  const toggle = document.getElementById('notifOfertas');
  if (!toggle || !window.db) return;

  window.db.getPreferenciaOfertas().then(ativado => {
    toggle.checked = ativado;
  });

  toggle.addEventListener('change', async () => {
    await window.db.salvarPreferenciaOfertas(toggle.checked);

    if (toggle.checked) {
      const modalEl = document.getElementById('modalNotifOfertasInfo');
      if (modalEl && window.bootstrap) new window.bootstrap.Modal(modalEl).show();
    }
  });
}

/**
 * Toggle "E-mail de novo agendamento", disponível para TODAS as contas, com
 * um texto de cada nível: o barbeiro recebe o aviso de que alguém marcou
 * horário na agenda dele; o cliente recebe a confirmação do pedido que
 * acabou de fazer (netlify/functions/agendamentos.js decide quem recebe
 * o quê; a preferência é guardada em notificacoes.js).
 */
async function iniciarToggleEmailAgendamentos() {
  const bloco = document.getElementById('blocoNotifEmail');
  const toggle = document.getElementById('notifEmailAgendamentos');
  const explicacao = document.getElementById('explicacaoNotifEmail');
  if (!bloco || !toggle || !window.db) return;

  const sessao = await getSessaoAtual();
  if (!sessao) { bloco.classList.add('d-none'); return; }

  if (explicacao) {
    explicacao.textContent = sessao.papel === 'equipe'
      ? 'Manda um e-mail pra você sempre que um cliente marcar um horário na sua agenda, além do aviso dentro do app.'
      : 'Manda um e-mail de confirmação com dia, horário, barbeiro e serviços sempre que você pedir um horário. Você acompanha o resto pelo app.';
  }
  window.db.getPreferenciaEmailAgendamentos().then(ativado => {
    toggle.checked = ativado;
  });

  toggle.addEventListener('change', async () => {
    await window.db.salvarPreferenciaEmailAgendamentos(toggle.checked);
    mostrarToast(toggle.checked ? 'E-mail de novo agendamento ativado.' : 'E-mail de novo agendamento desativado.', 'sucesso');
  });
}

/* ==========================================================================
   SOM DE NOTIFICAÇÃO — sintetizado via Web Audio API (sem arquivos de
   áudio externos), escolhido em Ajustes e salvo só neste navegador.
   ========================================================================== */
let bpAudioCtx = null;
function bpGetAudioContext() {
  if (!bpAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    bpAudioCtx = new AudioCtx();
  }
  if (bpAudioCtx.state === 'suspended') bpAudioCtx.resume();
  return bpAudioCtx;
}

function bpTocarTom(ctx, freq, inicio, duracao, tipo = 'sine', volume = 0.18) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = tipo;
  osc.frequency.value = freq;
  ganho.gain.setValueAtTime(0, ctx.currentTime + inicio);
  ganho.gain.linearRampToValueAtTime(volume, ctx.currentTime + inicio + 0.01);
  ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + duracao);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(ctx.currentTime + inicio);
  osc.stop(ctx.currentTime + inicio + duracao + 0.02);
}

/**
 * Toca o som de notificação escolhido pelo usuário. Cada opção tem um
 * timbre simples e curto, gerado na hora — não depende de nenhum arquivo
 * de áudio. "silencioso" não toca nada.
 */
async function bpTocarSomNotificacao(somForcado) {
  const som = somForcado || (window.db?.getSomNotificacao ? await window.db.getSomNotificacao() : 'padrao');
  if (som === 'silencioso') return;

  if (som === 'personalizado') {
    const salvo = window.db?.getSomPersonalizado ? await window.db.getSomPersonalizado() : null;
    if (!salvo?.url) return;
    try {
      new Audio(salvo.url).play().catch(() => {});
    } catch (e) {
      // Reprodução bloqueada pelo navegador (ex.: sem interação do usuário) — ignora.
    }
    return;
  }

  const ctx = bpGetAudioContext();
  if (!ctx) return;

  if (som === 'sino') {
    bpTocarTom(ctx, 1046.5, 0, 0.5, 'sine', 0.16); // dó6, sustentado, como um sininho
    bpTocarTom(ctx, 1568, 0.05, 0.4, 'sine', 0.10); // quinta acima, leve
  } else if (som === 'navalha') {
    // Dois cliques secos e metálicos, como o "tec-tec" de uma tesoura/navalha.
    bpTocarTom(ctx, 320, 0, 0.05, 'square', 0.12);
    bpTocarTom(ctx, 260, 0.09, 0.05, 'square', 0.12);
  } else {
    // Padrão: dois tons ascendentes, som de notificação genérico e discreto.
    bpTocarTom(ctx, 660, 0, 0.14, 'sine', 0.15);
    bpTocarTom(ctx, 880, 0.12, 0.18, 'sine', 0.15);
  }
}

/**
 * Valida um arquivo de áudio antes de salvá-lo como som personalizado:
 * até 1MB e no máximo 6 segundos de duração. A duração só é conhecida
 * depois de carregar o arquivo num <audio>, então a validação é
 * assíncrona (Promise).
 */
function bpValidarArquivoSom(arquivo) {
  return new Promise((resolve, reject) => {
    const UM_MB = 1 * 1024 * 1024;
    const DURACAO_MAX_SEGUNDOS = 6;

    if (arquivo.size > UM_MB) {
      reject('O arquivo deve ter no máximo 1MB.');
      return;
    }
    if (!arquivo.type.startsWith('audio/')) {
      reject('Selecione um arquivo de áudio (MP3, WAV, AIFF, AAC etc.).');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject('Não foi possível ler o arquivo.');
    reader.onload = () => {
      const dataUrl = reader.result;
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        if (audio.duration > DURACAO_MAX_SEGUNDOS + 0.25) {
          reject(`O áudio deve ter no máximo ${DURACAO_MAX_SEGUNDOS} segundos.`);
          return;
        }
        resolve(dataUrl);
      };
      audio.onerror = () => reject('Não foi possível ler este arquivo de áudio.');
      audio.src = dataUrl;
    };
    reader.readAsDataURL(arquivo);
  });
}

function iniciarSeletorSomNotificacao() {
  const select = document.getElementById('somNotificacao');
  const btnTestar = document.getElementById('btnTestarSom');
  const blocoPersonalizado = document.getElementById('blocoSomPersonalizado');
  const inputArquivo = document.getElementById('inputSomPersonalizado');
  const nomeArquivoLabel = document.getElementById('somPersonalizadoNome');
  if (!window.db) return;

  function atualizarVisibilidadeBloco() {
    if (!blocoPersonalizado || !select) return;
    blocoPersonalizado.style.display = select.value === 'personalizado' ? '' : 'none';
  }

  async function atualizarNomeArquivoSalvo() {
    if (!nomeArquivoLabel) return;
    const salvo = await window.db.getSomPersonalizado();
    nomeArquivoLabel.textContent = salvo?.nomeArquivo ? `Arquivo atual: ${salvo.nomeArquivo}` : '';
  }

  if (select) {
    window.db.getSomNotificacao().then(som => {
      select.value = som;
      atualizarVisibilidadeBloco();
    });
    atualizarNomeArquivoSalvo();
    select.addEventListener('change', async () => {
      const salvo = await window.db.salvarSomNotificacao(select.value);
      atualizarVisibilidadeBloco();
      if (salvo === 'personalizado' && !(await window.db.getSomPersonalizado())) {
        mostrarToast('Envie um arquivo de áudio para usar como som personalizado.', 'erro');
        return;
      }
      bpTocarSomNotificacao(salvo);
    });
  }

  if (inputArquivo) {
    inputArquivo.addEventListener('change', async () => {
      const arquivo = inputArquivo.files[0];
      if (!arquivo) return;

      try {
        const dataUrl = await bpValidarArquivoSom(arquivo);
        await window.db.salvarSomPersonalizado(dataUrl, arquivo.name);
        atualizarNomeArquivoSalvo();
        mostrarToast('Som personalizado salvo.', 'sucesso');
        bpTocarSomNotificacao('personalizado');
      } catch (mensagemErro) {
        mostrarToast(typeof mensagemErro === 'string' ? mensagemErro : 'Não foi possível usar este arquivo.', 'erro');
        inputArquivo.value = '';
      }
    });
  }

  if (btnTestar) {
    btnTestar.addEventListener('click', () => {
      bpTocarSomNotificacao(select ? select.value : undefined);
    });
  }
}

/* -----------------------------------------------------------------------
   Preferências salvas em sessionStorage (tema e escala de fonte)
   ----------------------------------------------------------------------- */
function aplicarPreferenciasSalvas() {
  const tema = sessionStorage.getItem('bp-tema');
  const escala = sessionStorage.getItem('bp-escala-fonte');
  if (tema) {
    document.documentElement.setAttribute('data-tema', tema);
    document.body.setAttribute('data-tema', tema);
  }
  if (escala) {
    document.documentElement.style.setProperty('--escala-fonte', escala);
  }
}

function emPastaSites() {
  return window.location.pathname.includes('/sites/');
}

function rota(nomeArquivo) {
  if (nomeArquivo === 'index.html') return emPastaSites() ? '../index.html' : 'index.html';
  return emPastaSites() ? nomeArquivo : `sites/${nomeArquivo}`;
}

/**
 * Resolve o caminho de uma imagem (asset local do template ou URL do
 * CDN de imagens). O terceiro parâmetro, opcional, pede uma versão
 * redimensionada quando a imagem vier do ImageKit (nosso CDN de
 * uploads) — assets locais do template (ex.: avatar-exemplo.jpg) não
 * são afetados, e uma URL de qualquer outro domínio é devolvida como
 * está, sem tentar aplicar transformação nenhuma.
 */
// Tamanhos padrão pedidos ao CDN, calculados a partir do tamanho real de
// cada container em CSS (arredondado para ~2x, pra ficar nítido em telas
// retina) — assim nunca baixamos a imagem em resolução completa só pra
// mostrar num círculo de 28px.
const TAMANHOS_IMAGEM_CDN = {
  dotCliente: { largura: 60, altura: 60, foco: 'auto' },   // .avatar-dot-cliente: 28px
  cartaoBarbeiro: { largura: 120, altura: 120, foco: 'auto' }, // .cartao-barbeiro img: 56px
  avatarPerfil: { largura: 200, altura: 200, foco: 'auto' },   // .avatar-circular: 96px (80px no mobile)
  iconeInfo: { largura: 60, altura: 60, foco: 'auto' },        // .bloco-info-icone-img/.preview: ~28-30px
  banner: { largura: 1600 },                                    // .capa-barbearia: largura total, até 420px de altura
};

/* ==========================================================================
   UTILITÁRIOS GERAIS: visibilidade por papel, imagens com falha, rodapé
   ========================================================================== */

/**
 * Mostra ou esconde elementos conforme o nível da conta.
 * Cada elemento declara para quem serve em data-visivel-para
 * ("cliente" | "equipe" | "master" | "barbeiro-comum"), e `niveis` diz quais
 * níveis a conta atual tem. Usa a classe d-none do Bootstrap: um
 * style="display:none" inline NÃO funciona em elementos com d-flex/d-block,
 * porque essas classes são "display: ... !important" e vencem o inline
 * (era por isso que botões de barbeiro apareciam para clientes).
 * data-exibir-como="flex" diz que o elemento, quando visível, é d-flex.
 */
function aplicarVisibilidadePorPapel(niveis) {
  document.querySelectorAll('[data-visivel-para]').forEach((el) => {
    mostrarElemento(el, Boolean(niveis[el.dataset.visivelPara]));
  });
}

/** Só deixa passar uma classe de ícone do Bootstrap ("bi-clock"); qualquer outra coisa vira o ícone padrão. */
function iconeBootstrapSeguro(classe) {
  return /^bi-[a-z0-9-]{1,40}$/.test(String(classe || '')) ? classe : 'bi-info-circle';
}

function mostrarElemento(el, visivel) {
  if (!el) return;
  const comoFlex = el.dataset.exibirComo === 'flex';
  el.classList.toggle('d-none', !visivel);
  if (comoFlex) el.classList.toggle('d-flex', visivel);
}

/**
 * Imagens que falham ao carregar: sem handlers "onerror" escritos no HTML
 * (a política de segurança do site, em netlify.toml, bloqueia scripts
 * inline). Em vez disso, um único ouvinte no documento trata todas:
 *   data-fallback-src="..."   troca pela imagem indicada (uma vez só)
 *   data-ocultar-em-erro      esconde a imagem
 */
function iniciarTratamentoImagensComFalha() {
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.fallbackSrc && !img.dataset.fallbackAplicado) {
      img.dataset.fallbackAplicado = '1';
      img.src = img.dataset.fallbackSrc;
    } else if ('ocultarEmErro' in img.dataset) {
      img.style.display = 'none';
    }
  }, true); // erro de <img> não "borbulha": só a fase de captura enxerga
}
iniciarTratamentoImagensComFalha();

/** "© 2026" no primeiro ano; "© 2026 - 2027" nos seguintes. Sempre o ano atual, sem editar nada. */
const ANO_INICIAL_SITE = 2026;
function textoAnoRodape(anoAtual = new Date().getFullYear()) {
  return anoAtual > ANO_INICIAL_SITE ? `${ANO_INICIAL_SITE} - ${anoAtual}` : String(ANO_INICIAL_SITE);
}
function atualizarAnoRodape() {
  document.querySelectorAll('[data-ano-rodape]').forEach((el) => { el.textContent = textoAnoRodape(); });
}

/**
 * Margem entre o fim do conteúdo e o rodapé fixo, em qualquer tela. O
 * rodapé (navegação inferior + copyright) tem altura diferente no celular,
 * no desktop, com fonte grande ou com o texto quebrando em duas linhas.
 * Em vez de chutar um valor no CSS, medimos a altura real e guardamos em
 * --altura-rodape (o CSS soma 32px de respiro).
 */
function iniciarMargemRodape() {
  const rodape = document.querySelector('.rodape-fixo');
  if (!rodape) return;
  const aplicar = () => {
    document.documentElement.style.setProperty('--altura-rodape', `${Math.ceil(rodape.getBoundingClientRect().height)}px`);
  };
  aplicar();
  if ('ResizeObserver' in window) new ResizeObserver(aplicar).observe(rodape);
  window.addEventListener('resize', aplicar);
  window.addEventListener('load', aplicar);
}

document.addEventListener('DOMContentLoaded', () => {
  atualizarAnoRodape();
  iniciarMargemRodape();
});

// Pixel transparente usado como src inicial das imagens que dependem do
// banco (avatar, capa). Assim nenhuma imagem "de exemplo" aparece por uns
// instantes antes da imagem verdadeira chegar.
const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Troca o src de uma <img> e só revela a imagem (tirando a classe
 * .img-carregando, que mostra um esqueleto animado) quando ela terminar
 * de carregar. Se o carregamento falhar, o onerror do próprio HTML decide
 * o que mostrar e o 'load' seguinte revela o resultado.
 */
function trocarImagemQuandoPronta(img, src) {
  if (!img) return;
  img.addEventListener('load', () => img.classList.remove('img-carregando'), { once: true });
  img.src = src;
}

/** Preenche um texto vindo do banco e remove o esqueleto de carregamento. */
function preencherTextoCarregado(el, texto) {
  if (!el) return;
  el.textContent = texto;
  el.classList.remove('skeleton', 'skeleton-linha');
}

function resolverAsset(valor, fallback = 'assets/img/avatar-exemplo.jpg', redimensionar = null) {
  const caminho = valor || fallback;
  if (/^(data:|blob:)/.test(caminho)) return caminho;
  if (/^https?:/.test(caminho)) {
    if (redimensionar && caminho.includes('ik.imagekit.io')) {
      const { largura, altura, foco } = redimensionar;
      const partes = [];
      if (largura) partes.push(`w-${largura}`);
      if (altura) partes.push(`h-${altura}`);
      if (foco) partes.push(`fo-${foco}`);
      if (partes.length) {
        const separador = caminho.includes('?') ? '&' : '?';
        return `${caminho}${separador}tr=${partes.join(',')}`;
      }
    }
    return caminho;
  }
  if (emPastaSites() && caminho.startsWith('assets/')) return `../${caminho}`;
  if (!emPastaSites() && caminho.startsWith('../')) return caminho.replace(/^\.\.\//, '');
  return caminho;
}

function getSessaoAtual() {
  return window.db?.getSessao ? window.db.getSessao() : Promise.resolve(null);
}

function paginaEquipe() {
  return /(^|\/)(painel-barbeiro|agendamentos|login-equipe)\.html(\?|$)/.test(window.location.pathname);
}

/**
 * Guard de acesso: impede que páginas restritas à equipe (painel do barbeiro,
 * agenda geral) sejam acessadas por quem não está logado como 'equipe'.
 * Deve rodar antes de qualquer outra inicialização de página.
 *
 * Atenção: usa caminho ancorado (fim de nome de arquivo) para não confundir
 * "agendamentos.html" (agenda da equipe) com "meus-agendamentos.html"
 * (agenda do cliente) ou "agendamento.html" (tela de novo agendamento).
 */
async function protegerRotaEquipe() {
  const caminho = window.location.pathname;
  const sessao = await getSessaoAtual();

  // login-equipe.html é a própria tela de login da equipe.
  // Se a equipe já estiver logada e cair aqui (ex.: link direto/favorito),
  // manda direto pro painel em vez de mostrar o formulário de novo.
  if (/(^|\/)login-equipe\.html(\?|$)/.test(caminho)) {
    if (sessao?.papel === 'equipe') {
      window.location.replace(rota('painel-barbeiro.html'));
      return false;
    }
    return true;
  }

  // login.html e cadastro.html são as telas de entrada/criação de conta do
  // cliente. Quem já está logado (cliente OU equipe) não deve ver a opção
  // de "criar conta"/"entrar" de novo — manda pra tela de perfil de cada um.
  if (/(^|\/)(login|cadastro)\.html(\?|$)/.test(caminho)) {
    if (sessao) {
      window.location.replace(sessao.papel === 'equipe' ? rota('painel-barbeiro.html') : rota('perfil.html'));
      return false;
    }
    return true;
  }

  const restrita = /(^|\/)(painel-barbeiro|agendamentos)\.html(\?|$)/.test(caminho);
  if (!restrita) return true;

  // Fallback: sem sessão OU sessão que não é de equipe (prioridade sempre
  // para a conta de equipe/admin acessar suas telas — qualquer outra conta
  // é barrada e mandada para o login correto da equipe).
  if (!sessao || sessao.papel !== 'equipe') {
    window.location.replace(rota('login-equipe.html'));
    return false;
  }
  return true;
}

async function linkPerfil() {
  return (await getSessaoAtual()) ? rota('perfil.html') : rota('login.html');
}

async function menuPrincipal() {
  const sessao = await getSessaoAtual();
  const perfilHref = await linkPerfil();
  if (paginaEquipe() || sessao?.papel === 'equipe') {
    return [
      { nav: 'inicio', href: rota('painel-barbeiro.html'), icon: 'bi-house-door', label: 'Início' },
      { nav: 'agenda', href: rota('agendamentos.html'), icon: 'bi-calendar3', label: 'Agenda' },
      { nav: 'localizacao', href: rota('localizacao.html'), icon: 'bi-geo-alt', label: 'Localização' },
      { nav: 'perfil', href: perfilHref, icon: 'bi-person', label: 'Perfil' },
      { nav: 'config', href: rota('preferencias-app.html'), icon: 'bi-gear', label: 'Ajustes' },
    ];
  }

  return [
    { nav: 'inicio', href: rota('index.html'), icon: 'bi-house-door', label: 'Início' },
    { nav: 'agenda', href: rota('servicos.html'), icon: 'bi-scissors', label: 'Serviços' },
    { nav: 'localizacao', href: rota('localizacao.html'), icon: 'bi-geo-alt', label: 'Localização' },
    { nav: 'perfil', href: perfilHref, icon: 'bi-person', label: 'Perfil' },
    { nav: 'config', href: rota('preferencias-app.html'), icon: 'bi-gear', label: 'Ajustes' },
  ];
}

async function menuInferior() {
  const sessao = await getSessaoAtual();
  const perfilHref = await linkPerfil();
  if (paginaEquipe() || sessao?.papel === 'equipe') {
    return [
      { nav: 'inicio', href: rota('painel-barbeiro.html'), icon: 'bi-house-door', label: 'Início' },
      { nav: 'agenda', href: rota('agendamentos.html'), icon: 'bi-calendar3', label: 'Agenda' },
      { nav: 'perfil', href: perfilHref, icon: 'bi-person', label: 'Perfil' },
      { nav: 'config', href: rota('preferencias-app.html'), icon: 'bi-gear', label: 'Ajustes' },
    ];
  }

  return [
    { nav: 'inicio', href: rota('index.html'), icon: 'bi-house-door', label: 'Início' },
    { nav: 'agenda', href: rota('meus-agendamentos.html'), icon: 'bi-calendar3', label: 'Agenda' },
    { nav: 'perfil', href: perfilHref, icon: 'bi-person', label: 'Perfil' },
    { nav: 'config', href: rota('preferencias-app.html'), icon: 'bi-gear', label: 'Ajustes' },
  ];
}

function navMarkup(item, desktop = false) {
  const classe = desktop ? 'nav-link-desktop' : '';
  return `<a href="${item.href}" class="${classe}" data-nav="${item.nav}"><i class="bi ${item.icon}"></i> ${item.label}</a>`;
}

function bottomMarkup(item) {
  return `<a href="${item.href}" class="nav-item" data-nav="${item.nav}"><i class="bi ${item.icon}"></i><span>${item.label}</span></a>`;
}

async function padronizarMenus() {
  const header = document.querySelector('.header-marca');
  let desktop = document.querySelector('.nav-desktop');
  if (!desktop && header) {
    desktop = document.createElement('nav');
    desktop.className = 'nav-desktop';
    desktop.setAttribute('aria-label', 'Navegação principal');
    const hamburguerBtn = document.getElementById('btnHamburguer');
    header.insertBefore(desktop, hamburguerBtn || null);
  }
  const itensMenu = await menuPrincipal();
  if (desktop) desktop.innerHTML = itensMenu.map(item => navMarkup(item, true)).join('');

  const hamburguer = document.querySelector('.menu-hamburguer-conteudo');
  if (hamburguer) hamburguer.innerHTML = itensMenu.map(item => navMarkup(item)).join('');

  let inferior = document.querySelector('.nav-inferior');
  if (!inferior) {
    const shell = document.querySelector('.app-shell');
    if (shell) {
      const rodape = document.createElement('div');
      rodape.className = 'rodape-fixo';
      rodape.innerHTML = `
        <nav class="nav-inferior" aria-label="Navegação inferior"></nav>
        <footer class="rodape-site">© <span data-ano-rodape>2026</span> Barbear Prime. Todos os direitos reservados.</footer>
      `;
      shell.appendChild(rodape);
      inferior = rodape.querySelector('.nav-inferior');
    }
  }
  const itensInferior = await menuInferior();
  if (inferior) inferior.innerHTML = itensInferior.map(bottomMarkup).join('');

  // Só revela o menu (ver regra "Anti-flicker da navegação" no CSS)
  // depois que todo o conteúdo acima já foi montado com os itens certos
  // pra esta sessão — evita mostrar o menu genérico (o do HTML estático)
  // nem por um instante antes de trocar para o de equipe/cliente.
  document.documentElement.classList.add('nav-pronta');
}

function marcarNavAtiva() {
  const paginaAtual = document.body.dataset.paginaAtual;
  if (!paginaAtual) return;
  document.querySelectorAll('[data-nav]').forEach(item => {
    item.classList.toggle('ativo', item.dataset.nav === paginaAtual);
    item.classList.toggle('active', item.dataset.nav === paginaAtual);
    if (item.dataset.nav === paginaAtual) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

/* ==========================================================================
   TOAST — Mensagens para o usuário
   ========================================================================== */
function mostrarToast(mensagem, tipo = 'sucesso') {
  const toast = document.getElementById('toastPrime');
  if (!toast) return;
  toast.textContent = mensagem;
  toast.className = `toast-prime mostrar ${tipo}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('mostrar');
  }, 2600);
}

/**
 * Toast com um botão "Desfazer" — usado nas ações que pedem confirmação de
 * retrocesso (editar perfil, editar/excluir serviço, marcar e cancelar
 * agendamento). Fica visível por mais tempo que o toast comum para dar
 * espaço pro clique. `aoDesfazer` só roda se o usuário clicar no botão
 * dentro da janela de tempo; depois disso a ação é considerada definitiva.
 */
function mostrarToastComDesfazer(mensagem, tipo, aoDesfazer, duracaoMs = 6000) {
  const toast = document.getElementById('toastPrime');
  if (!toast) return;
  clearTimeout(toast._timeout);
  toast.className = `toast-prime mostrar com-acao ${tipo}`;
  // escaparHtml() aqui dentro (em vez de exigir que quem chama lembre de
  // escapar) é de propósito: assim, mesmo que uma chamada futura passe
  // algo digitado por um usuário (nome de serviço, nome de cliente etc.)
  // sem se preocupar em escapar, esta function já protege sozinha.
  toast.innerHTML = `<span>${escaparHtml(mensagem)}</span><button type="button" class="toast-btn-desfazer">Desfazer</button>`;
  const btn = toast.querySelector('.toast-btn-desfazer');
  btn.addEventListener('click', async () => {
    clearTimeout(toast._timeout);
    toast.classList.remove('mostrar');
    await aoDesfazer();
  });
  toast._timeout = setTimeout(() => {
    toast.classList.remove('mostrar');
  }, duracaoMs);
}

window.addEventListener('bp:toast', (ev) => {
  mostrarToast(ev.detail?.mensagem || '', ev.detail?.tipo || 'sucesso');
});

window.addEventListener('bp:destaque-alterado', () => {
  renderizarServicosDestaqueHome();
});

window.addEventListener('bp:banner-alterado', () => {
  aplicarBannerSalvo();
});

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

/* ==========================================================================
   SERVIÇOS — Seleção, sanfona e contador
   ========================================================================== */
const SERVICOS_FALLBACK = {
  '1': { nome: 'Barba', preco: 20 },
  '2': { nome: 'Corte e Barba', preco: 45 },
  '3': { nome: 'Corte Padrão', preco: 30 },
  '4': { nome: 'Degradê', preco: 35 },
  '5': { nome: 'Pigmento', preco: 30 },
  '6': { nome: 'Sobrancelha', preco: 20 },
  '7': { nome: 'Reflexo', preco: 55 },
  '8': { nome: 'Nevou', preco: 145 },
};

async function servicosDados() {
  if (!window.db?.getServicos) return SERVICOS_FALLBACK;
  const servicos = await window.db.getServicos();
  return servicos.reduce((acc, servico) => {
    acc[servico.id] = servico;
    return acc;
  }, {});
}

function iniciarSelecaoServicos() {
  const lista = document.getElementById('listaServicos');
  const grid = document.getElementById('gridServicosCliente');
  if (!lista) return;

  async function renderizarGrid() {
    if (!grid || !window.db) return;
    const servicos = await window.db.getServicos();
    grid.innerHTML = servicos.map(s => `
      <div class="card-servico-site" data-servico-id="${s.id}" data-selecionado="0">
        <button type="button" class="servico-cabecalho" data-toggle-detalhe="${s.id}" aria-expanded="false" aria-controls="detalhe-${s.id}">
          <h3 class="fs-6 fw-bold mb-0">${escaparHtml(s.nome)}</h3>
          <span class="preco-tag">${formatarMoeda(s.preco)} <i class="bi bi-chevron-down"></i></span>
        </button>
        <div class="detalhe-servico" id="detalhe-${s.id}">
          ${s.descricao ? `<p class="texto-suave small mb-3">${escaparHtml(s.descricao)}</p>` : ''}
          <button class="btn btn-sm btn-outline-dark rounded-pill" data-toggle-selecao="${s.id}"><i class="bi bi-plus-lg me-1"></i> Agendar Serviço</button>
        </div>
      </div>
    `).join('');
  }

  renderizarGrid();
  window.addEventListener('bp:servicos-alterados', renderizarGrid);

  lista.addEventListener('click', (ev) => {
    const toggleSelecao = ev.target.closest('[data-toggle-selecao]');
    if (toggleSelecao) {
      toggleSelecao.classList.toggle('btn-dark');
      toggleSelecao.classList.toggle('btn-outline-dark');
      const selecionado = toggleSelecao.classList.contains('btn-dark');
      const icone = toggleSelecao.querySelector('i');
      if (icone) icone.className = selecionado ? 'bi bi-check-lg me-1' : 'bi bi-plus-lg me-1';
      toggleSelecao.lastChild.textContent = selecionado ? ' Serviço selecionado' : ' Agendar Serviço';

      const wrap = toggleSelecao.closest('[data-servico-id]');
      if (wrap) wrap.dataset.selecionado = selecionado ? '1' : '0';
      atualizarBarraSelecao();
      return;
    }

    const toggleDetalhe = ev.target.closest('[data-toggle-detalhe]');
    if (toggleDetalhe) {
      const id = toggleDetalhe.dataset.toggleDetalhe;
      const detalhe = document.getElementById(`detalhe-${id}`);
      if (!detalhe) return;
      const jaExpandido = detalhe.classList.contains('expandido');
      detalhe.classList.toggle('expandido', !jaExpandido);
      toggleDetalhe.setAttribute('aria-expanded', jaExpandido ? 'false' : 'true');
    }
  });

  const btnContinuar = document.getElementById('btnContinuarServicos');
  if (btnContinuar) {
    btnContinuar.addEventListener('click', (ev) => {
      const selecionados = [...document.querySelectorAll('[data-servico-id][data-selecionado="1"]')]
        .map(el => el.dataset.servicoId);
      if (selecionados.length === 0) {
        ev.preventDefault();
        mostrarToast('Selecione ao menos um serviço para continuar.', 'erro');
        return;
      }
      sessionStorage.setItem('bp-servicos-selecionados', JSON.stringify(selecionados));
    });
  }
}

function atualizarBarraSelecao() {
  const qtd = document.querySelectorAll('[data-servico-id][data-selecionado="1"]').length;
  const contador = document.getElementById('qtdServicosSelecionados');
  if (contador) contador.textContent = qtd;
}

/* ==========================================================================
   SERVIÇOS EM DESTAQUE — Edição no Painel do Barbeiro (reflete na Home)
   ========================================================================== */
async function iniciarServicosDestaqueEditavel() {
  const grid = document.getElementById('gridServicosDestaqueEditavel');
  if (!grid || !window.db) return;

  const MAX_DESTAQUES = 4;
  // Só o barbeiro MASTER pode mudar os destaques (mesma regra reforçada
  // no servidor em servicos.js) — um barbeiro comum ainda vê quais estão
  // em destaque agora, só não consegue clicar pra mudar.
  const sessaoAtual = await getSessaoAtual();
  const ehMaster = Boolean(sessaoAtual?.master);

  async function renderizar() {
    const [destaqueIds, servicos] = await Promise.all([
      window.db.getServicosDestaque(),
      window.db.getServicos(),
    ]);
    const destacados = new Set(destaqueIds);
    grid.innerHTML = servicos.map(servico => `
      <button type="button" class="chip-servico${destacados.has(servico.id) ? ' selecionado' : ''}" data-servico-destaque-id="${servico.id}"${ehMaster ? '' : ' disabled'}>
        ${escaparHtml(servico.nome)}<small>${formatarMoeda(servico.preco)}</small>
      </button>
    `).join('');
  }

  if (ehMaster) {
    grid.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-servico-destaque-id]');
      if (!btn) return;

      const atual = await window.db.getServicosDestaque();
      const id = btn.dataset.servicoDestaqueId;
      const jaSelecionado = atual.includes(id);

      if (!jaSelecionado && atual.length >= MAX_DESTAQUES) {
        mostrarToast(`Escolha no máximo ${MAX_DESTAQUES} serviços em destaque.`, 'erro');
        return;
      }

      const novaLista = jaSelecionado ? atual.filter(item => item !== id) : [...atual, id];
      await window.db.salvarServicosDestaque(novaLista);
      renderizar();
    });
  }

  window.addEventListener('bp:servicos-alterados', renderizar);

  renderizar();
}

/* ==========================================================================
   GERENCIAR SERVIÇOS — CRUD no Painel do Barbeiro (somente equipe)
   ========================================================================== */
async function iniciarGerenciarServicos() {
  const lista = document.getElementById('listaServicosGerenciar');
  const form = document.getElementById('formServico');
  if (!lista || !form || !window.db) return;

  const modalEl = document.getElementById('modalServico');
  const tituloModal = document.getElementById('modalServicoTitulo');
  const inputId = document.getElementById('servicoEditandoId');
  const inputNome = document.getElementById('servicoNome');
  const inputPreco = document.getElementById('servicoPreco');
  const inputDuracao = document.getElementById('servicoDuracao');
  const inputDescricao = document.getElementById('servicoDescricao');
  // Gerenciar o catálogo (criar/editar/excluir) é só do barbeiro MASTER —
  // um barbeiro comum vê a lista, sem os botões de ação (o servidor já
  // recusa a chamada mesmo assim — ver servicos.js — mas mostrar um botão
  // que sempre dá erro 403 só confunde). Buscado ANTES de qualquer outra
  // coisa nesta function, pra `renderizarLista()` já nascer com o valor
  // certo (closures em JS enxergam o valor atual da variável no momento
  // em que rodam, não o valor de quando foram definidas — então só
  // precisa estar certo antes da primeira chamada de verdade acontecer).
  const sessaoAtual = await getSessaoAtual();
  const ehMaster = Boolean(sessaoAtual?.master);

  async function renderizarLista() {
    const servicos = await window.db.getServicos();
    lista.innerHTML = servicos.length
      ? servicos.map(s => `
        <div class="card-prime p-3 mb-2 linha-servico-gerenciar" data-servico-linha-id="${s.id}">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <div class="fw-semibold small">${escaparHtml(s.nome)}</div>
              ${s.descricao ? `<div class="texto-suave small mt-1">${escaparHtml(s.descricao)}</div>` : ''}
              <div class="texto-suave small mt-1">${formatarMoeda(s.preco)} · ${s.duracaoMin || 30} min</div>
            </div>
          </div>
          ${ehMaster ? `
          <div class="acoes-agendamento-barbeiro">
            <button type="button" class="btn-acao-agenda" data-acao-servico="editar" data-servico-id="${s.id}"><i class="bi bi-pencil"></i> Editar</button>
            <button type="button" class="btn-acao-agenda perigo" data-acao-servico="excluir" data-servico-id="${s.id}"><i class="bi bi-trash3"></i> Excluir</button>
          </div>` : ''}
        </div>
      `).join('')
      : listaVazia('Nenhum serviço cadastrado.');
  }

  function abrirParaCriar() {
    inputId.value = '';
    form.reset();
    tituloModal.textContent = 'Novo serviço';
  }

  async function abrirParaEditar(id) {
    const servico = await window.db.getServicoPorId(id);
    if (!servico) return;
    inputId.value = servico.id;
    inputNome.value = servico.nome;
    inputPreco.value = servico.preco;
    inputDuracao.value = servico.duracaoMin || 30;
    inputDescricao.value = servico.descricao || '';
    tituloModal.textContent = 'Editar serviço';
    if (window.bootstrap && modalEl) new window.bootstrap.Modal(modalEl).show();
  }

  const btnNovo = document.getElementById('btnNovoServico');
  if (btnNovo) {
    btnNovo.style.display = ehMaster ? '' : 'none';
    btnNovo.addEventListener('click', abrirParaCriar);
  }

  lista.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-acao-servico]');
    if (!btn) return;
    const id = btn.dataset.servicoId;
    const acao = btn.dataset.acaoServico;

    if (acao === 'editar') {
      abrirParaEditar(id);
    } else if (acao === 'excluir') {
      const servico = await window.db.getServicoPorId(id);
      const confirmado = window.confirm(`Remover "${servico?.nome || 'este serviço'}" do catálogo? Agendamentos já marcados não são afetados.`);
      if (!confirmado) return;
      const linha = btn.closest('.linha-servico-gerenciar');
      if (linha) linha.classList.add('saindo');
      await window.db.excluirServico(id);
      setTimeout(renderizarLista, 200);
      if (servico) {
        // mostrarToastComDesfazer() já escapa a mensagem internamente —
        // não precisa (e não deve) escapar aqui de novo, senão um nome de
        // serviço com "&" apareceria como "&amp;" na tela.
        mostrarToastComDesfazer(`"${servico.nome}" removido.`, 'sucesso', async () => {
          // Recria o serviço com os mesmos dados (o id novo pode ser
          // diferente do original — agendamentos antigos guardam o nome
          // do serviço em snapshot próprio e não são afetados por isso).
          await window.db.criarServico({
            nome: servico.nome,
            preco: servico.preco,
            duracaoMin: servico.duracaoMin,
            descricao: servico.descricao,
          });
          mostrarToast('Serviço restaurado.', 'sucesso');
          renderizarLista();
        });
      }
    }
  });

  form.addEventListener('submit', bpEnvioSeguro(form, async (ev) => {
    ev.preventDefault();
    // Defesa extra: mesmo sem o botão "Novo serviço" nem os botões de
    // editar visíveis, se por algum motivo este formulário for enviado
    // (ex.: Enter num campo, modal deixado aberto de antes), não deixa
    // seguir — o servidor recusaria de qualquer forma (servicos.js), mas
    // aqui evita a chamada de rede e o erro 403 desnecessário.
    if (!ehMaster) return;
    const id = inputId.value;
    const dados = {
      nome: inputNome.value.trim(),
      preco: inputPreco.value,
      duracaoMin: inputDuracao.value,
      descricao: inputDescricao.value.trim(),
    };

    // Snapshot do serviço ANTES da edição, pra permitir "Desfazer".
    const servicoAntes = id ? await window.db.getServicoPorId(id) : null;

    const resultado = id
      ? await window.db.atualizarServico(id, dados)
      : await window.db.criarServico(dados);

    if (resultado) {
      const instancia = window.bootstrap?.Modal.getInstance(modalEl);
      if (instancia) instancia.hide();
      renderizarLista();
      if (servicoAntes) {
        mostrarToastComDesfazer('Serviço atualizado.', 'sucesso', async () => {
          await window.db.atualizarServico(id, {
            nome: servicoAntes.nome,
            preco: servicoAntes.preco,
            duracaoMin: servicoAntes.duracaoMin,
            descricao: servicoAntes.descricao,
          });
          mostrarToast('Alteração desfeita.', 'sucesso');
          renderizarLista();
        });
      }
    } else {
      bpReabilitarBotaoEnvio(form);
    }
  }));

  if (modalEl) {
    modalEl.addEventListener('hidden.bs.modal', abrirParaCriar);
  }

  window.addEventListener('bp:servicos-alterados', renderizarLista);

  renderizarLista();
}

/**
 * Grid de serviços em destaque exibido na Home (somente leitura), a
 * partir da configuração salva pela equipe no Painel do Barbeiro.
 */
async function renderizarServicosDestaqueHome() {
  const grid = document.getElementById('gridServicosDestaqueHome');
  if (!grid || !window.db) return;
  const titulo = document.getElementById('servicosDestaque');

  const dados = await servicosDados();
  const rota = (window.location.pathname.includes('/sites/')) ? 'servicos.html' : 'sites/servicos.html';
  const destaqueIds = await window.db.getServicosDestaque();

  // Se o barbeiro escolheu deliberadamente não destacar nada, a seção
  // inteira (título incluído) some da Home em vez de mostrar uma caixa vazia.
  const mostrarSecao = destaqueIds.length > 0;
  grid.style.display = mostrarSecao ? '' : 'none';
  if (titulo) titulo.style.display = mostrarSecao ? '' : 'none';
  if (!mostrarSecao) return;

  grid.innerHTML = destaqueIds.map(id => {
    const servico = dados[id];
    if (!servico) return '';
    return `<a href="${rota}" class="link-bloco chip-servico">${escaparHtml(servico.nome)}<small>${formatarMoeda(servico.preco)}</small></a>`;
  }).join('');
}

/* ==========================================================================
   LOCALIZAÇÃO — Exibe endereço salvo e permite edição (só equipe)
   ========================================================================== */
/* ==========================================================================
   INDICADOR DE OFFLINE — Injetado dinamicamente no rodapé de toda página
   ==========================================================================
   Mostra quando o app está sem conexão (dados sendo lidos do cache local)
   e quantas alterações estão esperando pra sincronizar. Ouve os eventos
   que database/db.js dispara (bp:fila-offline-alterada, bp:sincronizando,
   bp:sincronizacao-concluida) e os eventos nativos online/offline do
   navegador — não faz nenhuma leitura de dado sozinho.
   ========================================================================== */
function iniciarIndicadorOffline() {
  const banner = document.createElement('div');
  banner.className = 'faixa-offline';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const rodape = document.querySelector('.rodape-fixo');
  if (rodape) {
    rodape.insertBefore(banner, rodape.firstChild);
  } else {
    // Páginas sem o rodapé padrão (ex.: login-equipe.html, offline.html)
    // ainda precisam do aviso — mostra flutuando fixo na parte de baixo.
    banner.classList.add('flutuante');
    document.body.appendChild(banner);
  }

  function textoPendentes(n) {
    return n === 1 ? '1 alteração pendente' : `${n} alterações pendentes`;
  }

  function tamanhoFila() {
    return window.db?.getTamanhoFilaOffline ? window.db.getTamanhoFilaOffline() : 0;
  }

  function atualizar(sincronizando = false) {
    const pendentes = tamanhoFila();

    if (sincronizando) {
      banner.innerHTML = `<i class="bi bi-arrow-repeat"></i> Sincronizando ${textoPendentes(pendentes)}...`;
      banner.classList.add('mostrar');
      return;
    }

    if (!navigator.onLine) {
      const extra = pendentes ? ` ${textoPendentes(pendentes)}.` : '';
      banner.innerHTML = `<i class="bi bi-wifi-off"></i> Você está offline. As edições e atualizações serão sincronizadas quando você se conectar à rede novamente.${extra}`;
      banner.classList.add('mostrar');
      return;
    }

    if (pendentes) {
      banner.innerHTML = `<i class="bi bi-cloud-arrow-up"></i> ${textoPendentes(pendentes)} de sincronização.`;
      banner.classList.add('mostrar');
      return;
    }

    banner.classList.remove('mostrar');
  }

  window.addEventListener('online', () => atualizar());
  window.addEventListener('offline', () => atualizar());
  window.addEventListener('bp:fila-offline-alterada', () => atualizar());
  window.addEventListener('bp:sincronizando', () => atualizar(true));
  window.addEventListener('bp:sincronizacao-concluida', () => atualizar());

  atualizar();
}

async function iniciarLocalizacao() {
  const linha1El = document.getElementById('enderecoLinha1');
  if (!linha1El || !window.db?.getEnderecoBarbearia) return;

  const linha2El = document.getElementById('enderecoLinha2');
  const mapaIframe = document.getElementById('mapaLocalizacaoIframe');
  const blocosDisplay = document.getElementById('localizacaoInfoBlocos');
  const acoesEquipe = document.getElementById('localizacaoAcoesEquipe');
  const btnEditar = document.getElementById('btnEditarLocalizacao');
  const btnCancelar = document.getElementById('btnCancelarEditarLocalizacao');
  const form = document.getElementById('formEditarLocalizacao');
  const editorBlocos = document.getElementById('localizacaoBlocosEditor');
  const btnAdicionarBloco = document.getElementById('btnAdicionarBloco');
  const btnBuscarCep = document.getElementById('btnBuscarCep');

  function iconeOuPadrao(bloco) {
    // IMPORTANTE (segurança): bloco.icone vem do banco (config_app) e, na
    // teoria, poderia conter aspas/tags se alguém contornasse o upload e
    // mandasse a chamada à API direto. escaparHtml() aqui evita que esse
    // valor "quebre" o atributo src="" e injete HTML/JS — mesmo já
    // validando no backend, mantemos essa camada extra no front-end.
    if (bloco.icone) {
      const classeFormato = bloco.formato === 'circulo' ? ' formato-circulo' : '';
      return `<img src="${escaparHtml(resolverAsset(bloco.icone, undefined, TAMANHOS_IMAGEM_CDN.iconeInfo))}" alt="" class="bloco-info-icone-img${classeFormato}">`;
    }
    return `<i class="bi ${iconeBootstrapSeguro(bloco.iconeBootstrap)} fs-4 texto-dourado d-block"></i>`;
  }

  function renderizarBlocosDisplay(blocos) {
    if (!blocosDisplay) return;
    blocosDisplay.innerHTML = blocos.map(b => `
      <div class="text-center">
        ${iconeOuPadrao(b)}
        <span class="small texto-suave d-block mt-1">${escaparHtml(b.texto)}</span>
      </div>
    `).join('');
  }

  const mapaWrap = document.getElementById('mapaLocalizacaoWrap');

  async function preencherExibicao() {
    // Sem isso, uma falha de rede ou do servidor (ex.: instabilidade
    // momentânea na API) travava a página inteira num "Uncaught (in
    // promise)" — o esqueleto de carregamento ficava preso pra sempre e o
    // restante da função (inclusive os controles de edição do master, mais
    // abaixo) nunca chegava a rodar. Agora qualquer visitante — logado ou
    // não — vê uma mensagem clara em vez de uma tela quebrada, e o master
    // ainda consegue editar mesmo se só a leitura falhou.
    let endereco;
    try {
      endereco = await window.db.getEnderecoBarbearia();
    } catch (e) {
      console.error(e);
      preencherTextoCarregado(linha1El, 'Não foi possível carregar o endereço agora. Atualize a página em instantes.');
      preencherTextoCarregado(linha2El, '');
      if (mapaWrap) { mapaWrap.classList.remove('skeleton'); mapaWrap.style.display = 'none'; }
      if (blocosDisplay) blocosDisplay.innerHTML = '';
      return null;
    }
    // Nada aqui é texto fixo do HTML: tudo vem do banco. Se o master ainda
    // não cadastrou o endereço, a linha 1 avisa em vez de ficar vazia.
    preencherTextoCarregado(linha1El, endereco.linha1 || 'Endereço ainda não cadastrado.');
    preencherTextoCarregado(linha2El, endereco.linha2);
    if (mapaIframe && endereco.mapaBusca) {
      mapaIframe.src = `https://www.google.com/maps?q=${encodeURIComponent(endereco.mapaBusca)}&output=embed`;
    }
    if (mapaWrap) {
      mapaWrap.classList.remove('skeleton');
      mapaWrap.style.display = endereco.mapaBusca ? '' : 'none';
    }
    renderizarBlocosDisplay(endereco.infoBlocos);
    return endereco;
  }

  await preencherExibicao();

  const sessao = await getSessaoAtual();
  // Editar endereço/informações é só do barbeiro MASTER — um barbeiro
  // comum só vê a página, sem os controles de edição (mesma regra
  // reforçada no servidor em netlify/functions/config.js).
  if (sessao?.papel !== 'equipe' || !sessao?.master || !form) return;

  if (acoesEquipe) acoesEquipe.style.display = '';

  /* ---------------------- editor de blocos (adicionar/remover/ícone) ---------------------- */
  function novaLinhaBloco(bloco) {
    const linha = document.createElement('div');
    linha.className = 'd-flex align-items-center gap-2';
    linha.dataset.blocoIcone = bloco.icone || '';
    linha.dataset.blocoIconeBootstrap = iconeBootstrapSeguro(bloco.iconeBootstrap);
    linha.dataset.blocoFormato = bloco.formato === 'circulo' ? 'circulo' : 'quadrado';
    const classeFormatoInicial = linha.dataset.blocoFormato === 'circulo' ? ' formato-circulo' : '';
    linha.innerHTML = `
      <img src="${bloco.icone ? escaparHtml(resolverAsset(bloco.icone, undefined, TAMANHOS_IMAGEM_CDN.iconeInfo)) : ''}" alt="" class="bloco-info-icone-preview${classeFormatoInicial}" data-bloco-preview style="${bloco.icone ? '' : 'display:none;'}">
      <i class="bi ${iconeBootstrapSeguro(bloco.iconeBootstrap)} fs-4 texto-dourado" data-bloco-preview-padrao style="${bloco.icone ? 'display:none;' : ''}"></i>
      <input type="text" class="input-prime flex-grow-1" value="${escaparHtml(bloco.texto || '')}" placeholder="Ex.: Aceita cartão" data-bloco-texto>
      <button type="button" class="btn btn-sm btn-outline-secondary px-2" title="Alternar entre quadrado e círculo" data-bloco-alternar-formato>
        <i class="bi ${linha.dataset.blocoFormato === 'circulo' ? 'bi-circle' : 'bi-square'}"></i>
      </button>
      <label class="btn-outline-prime mb-0 px-2 py-1" title="Trocar ícone" style="cursor:pointer;">
        <i class="bi bi-image"></i>
        <input type="file" accept="image/*" class="visually-hidden" data-bloco-icone-input>
      </label>
      <button type="button" class="btn btn-sm text-danger" title="Remover" data-bloco-remover><i class="bi bi-trash3"></i></button>
    `;
    linha.querySelector('[data-bloco-icone-input]').addEventListener('change', async (ev) => {
      const arquivo = ev.target.files[0];
      ev.target.value = '';
      if (!arquivo) return;
      const recorte = await abrirEditorRecorte(arquivo, {
        proporcao: 1,
        larguraSaida: 240,
        circular: linha.dataset.blocoFormato === 'circulo',
        formatoSaida: 'image/png',
      });
      if (!recorte) return; // cancelado no editor
      linha.dataset.blocoNovoIcone = recorte;
      const preview = linha.querySelector('[data-bloco-preview]');
      const previewPadrao = linha.querySelector('[data-bloco-preview-padrao]');
      preview.src = recorte;
      preview.style.display = '';
      previewPadrao.style.display = 'none';
    });
    linha.querySelector('[data-bloco-alternar-formato]').addEventListener('click', (ev) => {
      const novoFormato = linha.dataset.blocoFormato === 'circulo' ? 'quadrado' : 'circulo';
      linha.dataset.blocoFormato = novoFormato;
      linha.querySelector('[data-bloco-preview]').classList.toggle('formato-circulo', novoFormato === 'circulo');
      ev.currentTarget.querySelector('i').className = novoFormato === 'circulo' ? 'bi bi-circle' : 'bi bi-square';
    });
    linha.querySelector('[data-bloco-remover]').addEventListener('click', () => linha.remove());
    return linha;
  }

  if (btnAdicionarBloco && editorBlocos) {
    btnAdicionarBloco.addEventListener('click', () => {
      editorBlocos.appendChild(novaLinhaBloco({ texto: '', icone: null, iconeBootstrap: 'bi-info-circle' }));
    });
  }

  /* ---------------------- busca de CEP (ViaCEP, sem chave de API) ---------------------- */
  if (btnBuscarCep) {
    btnBuscarCep.addEventListener('click', async () => {
      const cep = document.getElementById('localCep').value;
      const numero = document.getElementById('localNumero').value.trim();
      const resultado = await window.db.buscarCep(cep);
      if (!resultado) {
        mostrarToast('CEP não encontrado. Confira o número ou preencha manualmente.', 'erro');
        return;
      }
      const linha1 = numero ? `${resultado.logradouro}, Nº${numero}` : resultado.logradouro;
      const linha2 = `${resultado.bairro}, ${resultado.cidade}, ${resultado.uf}`;
      document.getElementById('localEndereco1').value = linha1;
      document.getElementById('localEndereco2').value = linha2;
      document.getElementById('localMapaBusca').value = `${resultado.logradouro}, ${numero}, ${resultado.bairro}, ${resultado.cidade}, ${resultado.uf}`;
      mostrarToast('Endereço preenchido a partir do CEP.', 'sucesso');
    });
  }

  if (btnEditar) {
    btnEditar.addEventListener('click', async () => {
      const endereco = await window.db.getEnderecoBarbearia();
      document.getElementById('localCep').value = endereco.cep;
      document.getElementById('localNumero').value = endereco.numero;
      document.getElementById('localEndereco1').value = endereco.linha1;
      document.getElementById('localEndereco2').value = endereco.linha2;
      document.getElementById('localMapaBusca').value = endereco.mapaBusca;
      if (editorBlocos) {
        editorBlocos.innerHTML = '';
        endereco.infoBlocos.forEach(b => editorBlocos.appendChild(novaLinhaBloco(b)));
      }
      form.style.display = '';
      btnEditar.style.display = 'none';
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      form.style.display = 'none';
      if (btnEditar) btnEditar.style.display = '';
    });
  }

  form.addEventListener('submit', bpEnvioSeguro(form, async (ev) => {
    ev.preventDefault();

    // Envia os ícones novos (arquivos escolhidos agora) antes de montar a
    // lista final — os que não mudaram mantêm a URL que já tinham.
    const linhasBloco = editorBlocos ? Array.from(editorBlocos.children) : [];
    const infoBlocos = [];
    for (const linha of linhasBloco) {
      const texto = linha.querySelector('[data-bloco-texto]').value.trim();
      if (!texto) continue; // linha vazia — ignora em vez de salvar um bloco sem texto
      let icone = linha.dataset.blocoIcone || null;
      if (linha.dataset.blocoNovoIcone) {
        const url = await window.db.enviarIconeInfoLocalizacao(linha.dataset.blocoNovoIcone);
        if (url) icone = url;
      }
      infoBlocos.push({ texto, icone, iconeBootstrap: linha.dataset.blocoIconeBootstrap || 'bi-info-circle', formato: linha.dataset.blocoFormato === 'circulo' ? 'circulo' : 'quadrado' });
    }

    const dados = {
      linha1: document.getElementById('localEndereco1').value.trim(),
      linha2: document.getElementById('localEndereco2').value.trim(),
      cep: document.getElementById('localCep').value.trim(),
      numero: document.getElementById('localNumero').value.trim(),
      mapaBusca: document.getElementById('localMapaBusca').value.trim(),
      infoBlocos,
    };
    const sucesso = await window.db.salvarEnderecoBarbearia(dados);
    if (sucesso) {
      await preencherExibicao();
      form.style.display = 'none';
      if (btnEditar) btnEditar.style.display = '';
    } else {
      bpReabilitarBotaoEnvio(form);
    }
  }));
}

/* ==========================================================================
   BANNER DA BARBEARIA — Upload no Painel do Barbeiro (reflete na Home)
   ========================================================================== */
async function aplicarBannerSalvo() {
  // A capa só aparece depois que o banco responde. Se não houver banner
  // salvo (ou a consulta falhar), usa a imagem que acompanha o site.
  let banner = null;
  try {
    banner = window.db?.getBannerBarbearia ? await window.db.getBannerBarbearia() : null;
  } catch (e) {
    banner = null;
  }
  const bannerRedimensionado = banner
    ? resolverAsset(banner, banner, TAMANHOS_IMAGEM_CDN.banner)
    : resolverAsset('assets/img/capa-barbearia.jpg');
  document.querySelectorAll('.capa-barbearia').forEach(img => {
    img.style.display = '';
    trocarImagemQuandoPronta(img, bannerRedimensionado);
  });
  await aplicarAjusteBanner();
}

/**
 * Rótulo do topo da Home e do Painel: "Barbearia · Cidade, UF".
 * A cidade e o estado saem do endereço cadastrado pelo barbeiro master na
 * tela de Localização (db.getEnderecoBarbearia().localidade), então mudam
 * junto com ele. Enquanto o banco não responde, o HTML mostra só
 * "Barbearia", que vale para qualquer endereço.
 */
async function aplicarRotuloLocalidade() {
  const el = document.getElementById('heroLocalidade');
  if (!el || !window.db?.getEnderecoBarbearia) return;
  try {
    const { localidade } = await window.db.getEnderecoBarbearia();
    el.textContent = localidade ? `Barbearia · ${localidade}` : 'Barbearia';
  } catch (e) {
    // sem conexão e sem cache: mantém o "Barbearia" do HTML
  }
}

/**
 * Aplica a preferência de recorte (cortar/manter proporção) na faixa
 * pública da Home. O painel do barbeiro (#capaBarbeariaImg dentro de
 * .hero-desktop) sempre mostra a foto inteira, então essa classe só afeta
 * o hero da Home — ver regra ".hero-desktop #capaBarbeariaImg" no CSS,
 * que é mais específica e vence mesmo se a classe estiver presente lá.
 */
const MODOS_BANNER = ['proporcao', 'recorte', 'tamanho-original', 'padrao'];

/**
 * Como a capa da Home é exibida (escolha do barbeiro master, salva no banco):
 *  proporcao         a foto inteira, na proporção dela;
 *  recorte           o recorte que o master fez, mostrado inteiro;
 *  tamanho-original  nos pixels reais, centralizada, sem esticar;
 *  padrao            o formato do capa-barbearia.jpg (1600x1056), com corte central.
 * O Painel do Barbeiro sempre mostra a foto inteira (é onde se troca a capa).
 */
async function aplicarAjusteBanner() {
  if (!window.db?.getAjusteBanner) return;
  let ajuste = 'padrao';
  try { ajuste = await window.db.getAjusteBanner(); } catch (e) { /* mantém o padrão */ }
  document.querySelectorAll('.capa-barbearia:not(#capaBarbeariaImg)').forEach((img) => {
    img.classList.remove('manter-proporcao');
    MODOS_BANNER.forEach(m => img.classList.toggle(`banner-modo-${m}`, m === ajuste));
  });
}

async function iniciarUploadBanner() {
  const btn = document.getElementById('btnAlterarBanner');
  const input = document.getElementById('inputBannerBarbearia');
  const imgAlvo = document.getElementById('capaBarbeariaImg');
  if (!btn || !input || !imgAlvo) return;

  // Trocar o banner é só do barbeiro MASTER (mesma regra reforçada no
  // servidor em upload.js) — some o botão pra um barbeiro comum, em vez
  // de deixar clicar e ganhar um erro 403.
  const sessaoAtual = await getSessaoAtual();
  if (!sessaoAtual?.master) {
    btn.style.display = 'none';
    return;
  }

  const modalEl = document.getElementById('modalEscolhaBanner');
  const preview = document.getElementById('previewEscolhaBanner');
  const info = document.getElementById('infoEscolhaBanner');
  const opcoes = document.getElementById('opcoesBanner');
  const LIMITE_BYTES = 2 * 1024 * 1024;
  // Formato do capa-barbearia.jpg (1600x1056): é o "padrão do site".
  const PROPORCAO_PADRAO = 1600 / 1056;

  // Estado da foto escolhida. Os botões do modal são ligados UMA vez (antes,
  // cada nova foto empilhava ouvintes e um clique podia enviar a foto errada).
  let pendente = null; // { arquivo, dataUrl, largura, altura }

  async function enviar(base64, ajuste) {
    const ok = await window.db.salvarBannerBarbearia(base64, ajuste);
    if (ok === false) return;
    await aplicarBannerSalvo(); // (db.js já mostra o aviso de sucesso)
  }

  const lerComoDataUrl = (arquivo) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(arquivo);
  });

  async function escolher(modo) {
    if (!pendente) return;
    const { arquivo, dataUrl } = pendente;
    window.bootstrap?.Modal.getInstance(modalEl)?.hide();

    if (modo === 'padrao') {
      const recorte = await abrirEditorRecorte(arquivo, { proporcao: PROPORCAO_PADRAO, larguraSaida: 1600, formatoSaida: 'image/jpeg' });
      if (recorte) await enviar(recorte, 'padrao');
    } else if (modo === 'recorte') {
      const recorte = await abrirEditorMargens(arquivo, { larguraMaxSaida: 1600 });
      if (recorte) await enviar(recorte, 'recorte');
    } else {
      // proporcao e tamanho-original sobem a foto do jeito que ela é, então
      // valem os limites de quem não passa por recorte (6000 px / 24 MP).
      const seguranca = await verificarImagemSegura(arquivo, { semRecorte: true });
      if (!seguranca.ok) { mostrarToast(seguranca.motivo, 'erro'); return; }
      await enviar(dataUrl, modo);
    }
  }

  opcoes?.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-banner-modo]');
    if (botao) escolher(botao.dataset.bannerModo);
  });
  modalEl?.addEventListener('hidden.bs.modal', () => { pendente = null; });

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const arquivo = input.files[0];
    input.value = '';
    if (!arquivo) return;

    if (arquivo.size > LIMITE_BYTES) {
      mostrarToast('A imagem deve ter no máximo 2MB.', 'erro');
      return;
    }
    const seguranca = await verificarImagemSegura(arquivo);
    if (!seguranca.ok) { mostrarToast(seguranca.motivo, 'erro'); return; }

    const dataUrl = await lerComoDataUrl(arquivo);
    pendente = { arquivo, dataUrl, largura: seguranca.largura, altura: seguranca.altura };

    if (!modalEl || !window.bootstrap) {
      await escolher('padrao'); // sem o modal nesta página: usa o padrão do site
      return;
    }
    if (preview) preview.src = dataUrl;
    if (info) info.textContent = `Foto escolhida: ${seguranca.largura} x ${seguranca.altura} px`;
    new window.bootstrap.Modal(modalEl).show();
  });
}

/* ==========================================================================
   DESTAQUES DA HOME (a faixa "Desde 2016 ...") — vêm do banco e o master edita
   ========================================================================== */
async function iniciarFaixaValores() {
  const faixa = document.getElementById('faixaValores');
  if (!faixa || !window.db?.getFaixaValores) return;

  const itensEl = [...faixa.querySelectorAll('.item-valor')];
  let itens = null;
  try { itens = await window.db.getFaixaValores(); } catch (e) { itens = null; }

  function preencher(lista) {
    itensEl.forEach((el, i) => {
      const dado = lista?.[i];
      const tit = el.querySelector('[data-faixa-titulo]');
      const txt = el.querySelector('[data-faixa-texto]');
      const existe = Boolean(dado?.titulo);
      el.classList.toggle('d-none', !existe);
      if (existe) {
        preencherTextoCarregado(tit, dado.titulo);
        preencherTextoCarregado(txt, dado.texto || '');
        tit.classList.remove('d-block', 'mx-auto');
        txt.classList.toggle('d-none', !dado.texto);
      }
    });
    // Sem nenhum destaque cadastrado: a faixa some (na Home); no Painel
    // continua visível para o master poder cadastrar.
    const algum = (lista || []).some(d => d?.titulo);
    if (!algum && !document.getElementById('btnEditarFaixa')) faixa.classList.add('d-none');
  }
  preencher(itens);

  // ---- edição (só master, no Painel do Barbeiro)
  const btnEditar = document.getElementById('btnEditarFaixa');
  const form = document.getElementById('formFaixa');
  const campos = document.getElementById('camposFaixa');
  if (!btnEditar || !form || !campos) return;
  const sessao = await getSessaoAtual();
  if (!sessao?.master) return; // continua d-none
  mostrarElemento(btnEditar, true);

  const ICONES = ['bi-award', 'bi-scissors', 'bi-star'];
  function montarCampos() {
    campos.innerHTML = itensEl.map((_, i) => `
      <div class="mb-3 pb-2 border-bottom">
        <p class="small fw-bold mb-2"><i class="bi ${ICONES[i]} me-1"></i> Destaque ${i + 1}</p>
        <label class="form-label small" for="faixaTitulo${i}">Título</label>
        <input type="text" class="input-prime mb-2" id="faixaTitulo${i}" maxlength="40" value="${escaparHtml(itens?.[i]?.titulo || '')}">
        <label class="form-label small" for="faixaTexto${i}">Descrição</label>
        <input type="text" class="input-prime" id="faixaTexto${i}" maxlength="90" value="${escaparHtml(itens?.[i]?.texto || '')}">
      </div>`).join('');
  }
  document.getElementById('modalFaixa')?.addEventListener('show.bs.modal', montarCampos);

  form.addEventListener('submit', bpEnvioSeguro(form, async (ev) => {
    ev.preventDefault();
    const novos = itensEl.map((_, i) => ({
      titulo: document.getElementById(`faixaTitulo${i}`).value.trim(),
      texto: document.getElementById(`faixaTexto${i}`).value.trim(),
    })).filter(d => d.titulo);
    if (!novos.length) {
      mostrarToast('Preencha pelo menos um título.', 'erro');
      return;
    }
    const ok = await window.db.salvarFaixaValores(novos);
    if (ok === false) return;
    itens = novos;
    preencher(novos);
    window.bootstrap?.Modal.getInstance(document.getElementById('modalFaixa'))?.hide();
    mostrarToast('Destaques atualizados.', 'sucesso');
  }));
}

/* ==========================================================================
   AGENDAMENTO DINÂMICO — Carrega serviços e gerencia confirmação
   ========================================================================== */
function formatarData(iso) {
  if (!iso) return '';
  // slice(0, 10) pega só "AAAA-MM-DD", mesmo se `iso` vier com hora/fuso
  // junto (ex.: "2026-09-25T00:00:00.000Z" — é assim que o Postgres às
  // vezes devolve uma coluna DATE depois de passar pelo driver e virar
  // JSON). Sem isso, o split('-') pegava o pedaço errado e a tela
  // mostrava algo como "25T00:00:00.000Z" no lugar do dia.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const data = new Date(y, m - 1, d);
  const diasSemana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${diasSemana[data.getDay()]}, ${d} de ${meses[m-1]}`;
}

function formatarDataCurta(iso) {
  if (!iso) return '';
  // Mesmo cuidado de formatarData() acima — ver o comentário lá.
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

async function nomesServicos(servicoIds) {
  const dados = await servicosDados();
  return (servicoIds || []).map(id => dados[id]?.nome).filter(Boolean).join(' + ') || 'Serviço';
}

/**
 * Nomes dos serviços de um agendamento já existente — usa o snapshot
 * gravado no momento da marcação quando disponível (não muda se o
 * catálogo for editado depois). Cai em nomesServicos() para dados antigos
 * sem snapshot.
 */
async function nomesServicosDoAgendamento(agendamento) {
  if (window.db?.nomesServicosAgendamento) {
    const nomes = await window.db.nomesServicosAgendamento(agendamento);
    if (nomes?.length) return nomes.join(' + ');
  }
  return nomesServicos(agendamento?.servicoIds);
}

async function iniciarAgendamentoDinamico() {
  const chipWrap = document.getElementById('chipsServicosSelecionados');
  const listaResumo = document.getElementById('listaResumoServicos');
  const totalEl = document.getElementById('totalAgendamento');
  const modalResumoEl = document.getElementById('modalResumoServicos');
  const modalTotalEl = document.getElementById('modalTotalAgendamento');
  const modalQtdEl = document.getElementById('modalQtdServicos');

  if (!chipWrap) return;

  const ids = JSON.parse(sessionStorage.getItem('bp-servicos-selecionados') || '[]');
  const dados = await servicosDados();
  const servicos = ids.map(id => dados[id]).filter(Boolean);

  if (servicos.length === 0) {
    chipWrap.innerHTML = '<p class="texto-suave small">Nenhum serviço selecionado. <a href="servicos.html">Voltar</a></p>';
  } else {
    chipWrap.innerHTML = servicos.map(s =>
      `<div class="chip-servico selecionado">${escaparHtml(s.nome)}<small>${formatarMoeda(s.preco)}</small></div>`
    ).join('');
  }

  const total = servicos.reduce((acc, s) => acc + s.preco, 0);
  const totalFmt = formatarMoeda(total);

  if (listaResumo) {
    listaResumo.innerHTML = servicos.map(s =>
      `<li class="d-flex justify-content-between"><span>${escaparHtml(s.nome)}</span><span>${formatarMoeda(s.preco)}</span></li>`
    ).join('');
  }
  if (totalEl) totalEl.textContent = totalFmt;

  /* -------------------------- Seleção de barbeiro -------------------------- */
  const blocoBarbeiro = document.getElementById('blocoEscolherBarbeiro');
  const gridBarbeiro = document.getElementById('gridEscolherBarbeiro');
  const resumoBarbeiroWrap = document.getElementById('resumoBarbeiroWrap');
  const resumoBarbeiroEl = document.getElementById('resumoBarbeiro');
  const barbeiros = window.db?.getBarbeiros ? await window.db.getBarbeiros() : [];
  let barbeiroSelecionadoId = barbeiros.length === 1 ? barbeiros[0].id : null;

  // Com só 1 barbeiro cadastrado, seleciona automaticamente e não mostra a
  // etapa de escolha — mantém o fluxo simples como era antes de existir
  // múltiplos barbeiros. Com 2+ contas de equipe, mostra a seleção.
  if (barbeiros.length > 1 && blocoBarbeiro && gridBarbeiro) {
    blocoBarbeiro.style.display = '';
    gridBarbeiro.innerHTML = barbeiros.map(b => `
      <button type="button" class="cartao-barbeiro" data-barbeiro-id="${b.id}">
        <img src="${escaparHtml(resolverAsset(b.avatar, undefined, TAMANHOS_IMAGEM_CDN.cartaoBarbeiro))}" alt="Foto de ${escaparHtml(b.nome)}">
        <span class="small fw-semibold">${escaparHtml(b.nome)}</span>
      </button>
    `).join('');

    gridBarbeiro.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-barbeiro-id]');
      if (!btn) return;
      barbeiroSelecionadoId = btn.dataset.barbeiroId;
      window.bpBarbeiroSelecionadoId = barbeiroSelecionadoId;
      gridBarbeiro.querySelectorAll('.cartao-barbeiro').forEach(el =>
        el.classList.toggle('selecionado', el === btn)
      );
      if (resumoBarbeiroWrap && resumoBarbeiroEl) {
        const b = barbeiros.find(item => String(item.id) === barbeiroSelecionadoId);
        resumoBarbeiroEl.textContent = b?.nome || '...';
        resumoBarbeiroWrap.style.display = '';
      }
      // Horários dependem do barbeiro escolhido — avisa o calendário para recarregar.
      window.dispatchEvent(new CustomEvent('bp:barbeiro-selecionado', { detail: barbeiroSelecionadoId }));
    });
  } else if (resumoBarbeiroWrap && resumoBarbeiroEl && barbeiroSelecionadoId) {
    window.bpBarbeiroSelecionadoId = barbeiroSelecionadoId;
    const unico = barbeiros[0];
    resumoBarbeiroEl.textContent = unico?.nome || '...';
    resumoBarbeiroWrap.style.display = '';
  }

  function atualizarResumo() {
    const diaSelecionado = document.querySelector('.dia-btn.selecionado');
    const horaSelecionada = document.querySelector('.slot-horario.selecionado');
    const dataTexto = diaSelecionado ? formatarData(diaSelecionado.dataset.data) : 'Data não selecionada';
    const horaTexto = horaSelecionada ? horaSelecionada.dataset.hora : '--:--';

    document.getElementById('resumoData') && (document.getElementById('resumoData').textContent = dataTexto);
    document.getElementById('resumoHora') && (document.getElementById('resumoHora').textContent = horaTexto);
    document.getElementById('modalResumoData') && (document.getElementById('modalResumoData').textContent = dataTexto);
    document.getElementById('modalResumoHora') && (document.getElementById('modalResumoHora').textContent = horaTexto);

    if (modalResumoEl) {
      modalResumoEl.innerHTML = servicos.map(s =>
        `<li class="d-flex justify-content-between"><span>${escaparHtml(s.nome)}</span><span>${formatarMoeda(s.preco)}</span></li>`
      ).join('');
    }
    if (modalTotalEl) modalTotalEl.textContent = totalFmt;
    if (modalQtdEl) modalQtdEl.textContent = servicos.length;
  }

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('.dia-btn') || ev.target.closest('.slot-horario')) {
      setTimeout(atualizarResumo, 50);
    }
  });

  // Confirmação de agendamento (usa window.db)
  const modalConfirmBtn = document.querySelector('#modalConfirmarAgendamento .btn-prime');
  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', async function(ev) {
      const dia = document.querySelector('.dia-btn.selecionado');
      const hora = document.querySelector('.slot-horario.selecionado');
      if (!dia || !hora) {
        ev.preventDefault();
        mostrarToast('Selecione uma data e horário.', 'erro');
        return;
      }
      if (barbeiros.length > 1 && !barbeiroSelecionadoId) {
        ev.preventDefault();
        mostrarToast('Selecione o barbeiro para continuar.', 'erro');
        return;
      }
      const servicoIds = ids.filter(id => dados[id]);
      const agendamento = await window.db.salvarAgendamentoLocal(servicoIds, dia.dataset.data, hora.dataset.hora, barbeiroSelecionadoId);
      if (!agendamento) {
        ev.preventDefault();
      } else {
        // meus-agendamentos.html lê isso ao carregar pra oferecer "Desfazer"
        // (cancelar) o agendamento recém-criado por alguns segundos.
        try {
          sessionStorage.setItem('bp-ultimo-agendamento-criado', JSON.stringify({ id: agendamento.id, ts: Date.now() }));
        } catch (e) { /* sessionStorage indisponível, sem problema */ }
      }
    });
  }

  atualizarResumo();
}

/* ==========================================================================
   PREFERÊNCIAS DE CORTE
   ========================================================================== */
async function iniciarGruposPreferencia() {
  const sessao = await window.db.getSessao();
  if (!sessao) return;

  const preferenciasSalvas = await window.db.getPreferenciasCorte(sessao.usuarioId);
  const notas = document.getElementById('notasAdicionais');
  if (notas && preferenciasSalvas.notas) notas.value = preferenciasSalvas.notas;

  document.querySelectorAll('[data-grupo]').forEach(grupo => {
    const nomeGrupo = grupo.dataset.grupo;
    const valorSalvo = preferenciasSalvas[nomeGrupo];

    if (valorSalvo) {
      grupo.querySelectorAll('.opcao-pref').forEach(btn => {
        btn.classList.toggle('ativa', btn.dataset.valor === valorSalvo);
      });
    }

    grupo.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.opcao-pref');
      if (!btn) return;
      grupo.querySelectorAll('.opcao-pref').forEach(b => b.classList.remove('ativa'));
      btn.classList.add('ativa');

      const preferencias = await window.db.getPreferenciasCorte(sessao.usuarioId);
      preferencias[nomeGrupo] = btn.dataset.valor;
      await window.db.salvarPreferenciasCorte(sessao.usuarioId, preferencias);
      mostrarToast('Preferência salva!', 'sucesso');
    });
  });
}

function iniciarSalvarPreferenciasCorte() {
  const btnSalvar = document.querySelector('#preferenciasCorteSalvar');
  if (!btnSalvar) return;

  btnSalvar.addEventListener('click', async () => {
    const sessao = await window.db.getSessao();
    if (!sessao) {
      mostrarToast('Você precisa estar logado.', 'erro');
      return;
    }

    const preferencias = await window.db.getPreferenciasCorte(sessao.usuarioId);
    const notas = document.getElementById('notasAdicionais');
    if (notas) preferencias.notas = notas.value;

    document.querySelectorAll('[data-grupo]').forEach(grupo => {
      const ativo = grupo.querySelector('.opcao-pref.ativa');
      if (ativo) {
        preferencias[grupo.dataset.grupo] = ativo.dataset.valor;
      }
    });

    await window.db.salvarPreferenciasCorte(sessao.usuarioId, preferencias);
    mostrarToast('Preferências salvas!', 'sucesso');
  });
}

/* ==========================================================================
   EDITOR DE RECORTE DE IMAGEM — arrastar pra posicionar + zoom
   ==========================================================================
   Reutilizado pelo avatar (quadrado), pelo banner do painel (retangular
   bem largo) e pelos ícones de blocos de informação da Localização
   (quadrado, com prévia redonda ou de cantos arredondados conforme o
   formato escolhido). O arquivo final SEMPRE sai retangular — a "forma"
   redonda de um avatar ou ícone é sempre aplicada depois, via CSS
   (border-radius), por quem exibe a imagem; não precisa (e não compensa)
   gravar uma máscara circular nos pixels de verdade.
   ========================================================================== */

/**
 * @param {File} arquivo Imagem escolhida pela pessoa.
 * @param {Object} opcoes
 *   proporcao — largura/altura do recorte final (1 = quadrado, 3 = faixa larga tipo banner)
 *   larguraSaida — resolução horizontal do arquivo exportado, em pixels
 *   circular — true só muda a PRÉVIA (janela de recorte redonda); o
 *     arquivo exportado continua retangular de qualquer forma
 *   formatoSaida — 'image/jpeg' (fotos, arquivo menor) ou 'image/png'
 *     (ícones simples, preserva transparência se houver)
 * @returns {Promise<string|null>} dataURL do recorte, ou null se cancelado
 */
/* ==========================================================================
   IMAGENS ENVIADAS PELO USUÁRIO: conferência ANTES de decodificar
   ========================================================================== */
// Um arquivo pequeno pode declarar dimensões enormes (uma "bomba de
// descompressão": poucos KB que viram gigabytes de pixels ao abrir). Ler o
// cabeçalho é barato e seguro; decodificar não é. Por isso lemos largura e
// altura direto dos primeiros bytes e recusamos ANTES de criar a imagem ou
// o canvas. O servidor repete a mesma conferência (netlify/functions/_lib/imagem.js).
const LIMITE_LADO_ENTRADA = 12000;             // px
const LIMITE_PIXELS_ENTRADA = 64 * 1000 * 1000; // 64 megapixels
const LIMITE_LADO_SEM_RECORTE = 6000;          // mesma regra do servidor
const LIMITE_PIXELS_SEM_RECORTE = 24 * 1000 * 1000;

function lerDimensoesDoCabecalho(b) {
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i) => b[i] | (b[i + 1] << 8);
  const txt = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && txt(1, 3) === 'PNG') return { w: u32(16), h: u32(20) };
  if (b.length >= 10 && txt(0, 3) === 'GIF') return { w: le16(6), h: le16(8) };
  if (b.length >= 30 && txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP') {
    const tipo = txt(12, 4);
    if (tipo === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (tipo === 'VP8L') { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 }; }
    if (tipo === 'VP8X') return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) };
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

/**
 * Confere se o arquivo é uma imagem de tipo aceito e de tamanho razoável.
 * Devolve { ok:true, largura, altura } ou { ok:false, motivo }.
 * `semRecorte` usa o limite do servidor (imagem que sobe do jeito que está).
 */
async function verificarImagemSegura(arquivo, { semRecorte = false } = {}) {
  if (!arquivo || !/^image\/(png|jpeg|webp|gif)$/.test(arquivo.type)) {
    return { ok: false, motivo: 'Use uma imagem PNG, JPG, WEBP ou GIF.' };
  }
  const bytes = new Uint8Array(await arquivo.slice(0, 256 * 1024).arrayBuffer());
  const dim = lerDimensoesDoCabecalho(bytes);
  if (!dim || !dim.w || !dim.h) return { ok: false, motivo: 'Não foi possível ler essa imagem. Ela pode estar corrompida.' };
  const maxLado = semRecorte ? LIMITE_LADO_SEM_RECORTE : LIMITE_LADO_ENTRADA;
  const maxPixels = semRecorte ? LIMITE_PIXELS_SEM_RECORTE : LIMITE_PIXELS_ENTRADA;
  if (dim.w > maxLado || dim.h > maxLado || dim.w * dim.h > maxPixels) {
    return {
      ok: false,
      motivo: `A imagem é grande demais (${dim.w}x${dim.h}). ${semRecorte ? 'Para usá-la sem recortar, reduza para no máximo 6000 px de lado.' : 'Reduza o tamanho e tente de novo.'}`,
    };
  }
  return { ok: true, largura: dim.w, altura: dim.h };
}

/**
 * Editor de corte por MARGENS: quatro controles (esquerda, direita, topo e
 * base, em %) mostram em tempo real o que será cortado. Devolve a imagem já
 * recortada (data URL JPEG) ou null se cancelar.
 */
function abrirEditorMargens(arquivo, { larguraMaxSaida = 1600 } = {}) {
  return new Promise(async (resolve) => {
    const seguranca = await verificarImagemSegura(arquivo);
    if (!seguranca.ok) { mostrarToast(seguranca.motivo, 'erro'); resolve(null); return; }

    const modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-prime">
          <div class="modal-header">
            <h2 class="modal-title fs-5 fonte-display">Cortar como eu quiser</h2>
            <button type="button" class="btn-close" aria-label="Fechar" data-margens-cancelar></button>
          </div>
          <div class="modal-body">
            <div class="position-relative mb-3" style="line-height:0;" data-margens-area>
              <img alt="Prévia do corte" style="width:100%;max-height:45vh;object-fit:contain;display:block;background:#000;border-radius:var(--raio);">
              <div data-margens-sombras aria-hidden="true"></div>
            </div>
            ${[['esq', 'Esquerda'], ['dir', 'Direita'], ['topo', 'Topo'], ['base', 'Base']].map(([k, nome]) => `
              <div class="d-flex align-items-center gap-2 mb-1">
                <label class="small" style="width:70px;" for="margem-${k}">${nome}</label>
                <input type="range" class="form-range flex-grow-1" id="margem-${k}" data-margem="${k}" min="0" max="45" step="1" value="0">
                <output class="small texto-suave" style="width:36px;text-align:right;" data-saida="${k}">0%</output>
              </div>`).join('')}
            <p class="texto-suave small mt-2 mb-0">A parte escurecida será cortada. A imagem final fica no formato do que sobrar.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-margens-cancelar>Cancelar</button>
            <button type="button" class="btn-prime" data-margens-confirmar>Usar este corte</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modalEl);

    const img = modalEl.querySelector('img');
    const sombras = modalEl.querySelector('[data-margens-sombras]');
    const margens = { esq: 0, dir: 0, topo: 0, base: 0 };
    const instancia = window.bootstrap ? new window.bootstrap.Modal(modalEl, { backdrop: 'static' }) : null;
    let carregada = false;
    let resultadoPendente = null;

    function areaImagem() {
      // a imagem usa object-fit: contain; a área útil é a caixa real da imagem dentro do elemento
      const caixa = img.getBoundingClientRect();
      const proporcaoImg = img.naturalWidth / img.naturalHeight;
      let w = caixa.width;
      let h = caixa.height;
      if (w / h > proporcaoImg) w = h * proporcaoImg; else h = w / proporcaoImg;
      return { x: (caixa.width - w) / 2, y: (caixa.height - h) / 2, w, h };
    }
    function desenharSombras() {
      if (!carregada) return;
      const a = areaImagem();
      const barra = (estilo) => `<div style="position:absolute;background:rgba(0,0,0,.62);pointer-events:none;${estilo}"></div>`;
      const l = a.w * margens.esq / 100, r = a.w * margens.dir / 100, t = a.h * margens.topo / 100, b = a.h * margens.base / 100;
      sombras.innerHTML =
        barra(`left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${t}px;`) +
        barra(`left:${a.x}px;top:${a.y + a.h - b}px;width:${a.w}px;height:${b}px;`) +
        barra(`left:${a.x}px;top:${a.y + t}px;width:${l}px;height:${a.h - t - b}px;`) +
        barra(`left:${a.x + a.w - r}px;top:${a.y + t}px;width:${r}px;height:${a.h - t - b}px;`);
    }

    modalEl.querySelectorAll('[data-margem]').forEach((campo) => {
      campo.addEventListener('input', () => {
        const chave = campo.dataset.margem;
        let valor = Number(campo.value);
        // sempre sobra pelo menos 10% de largura e de altura
        const oposta = { esq: 'dir', dir: 'esq', topo: 'base', base: 'topo' }[chave];
        valor = Math.min(valor, 90 - margens[oposta]);
        campo.value = String(valor);
        margens[chave] = valor;
        modalEl.querySelector(`[data-saida="${chave}"]`).textContent = `${valor}%`;
        desenharSombras();
      });
    });

    img.onload = () => { carregada = true; desenharSombras(); };
    img.onerror = () => { mostrarToast('Não foi possível abrir essa imagem.', 'erro'); if (instancia) instancia.hide(); else { modalEl.remove(); resolve(null); } };
    img.src = URL.createObjectURL(arquivo);
    window.addEventListener('resize', desenharSombras);

    modalEl.addEventListener('hidden.bs.modal', () => {
      window.removeEventListener('resize', desenharSombras);
      URL.revokeObjectURL(img.src);
      modalEl.remove();
      resolve(resultadoPendente);
    });

    modalEl.querySelectorAll('[data-margens-cancelar]').forEach(b => b.addEventListener('click', () => { resultadoPendente = null; instancia?.hide(); }));
    modalEl.querySelector('[data-margens-confirmar]').addEventListener('click', () => {
      if (!carregada) return;
      const sx = Math.round(img.naturalWidth * margens.esq / 100);
      const sy = Math.round(img.naturalHeight * margens.topo / 100);
      const sw = Math.max(1, Math.round(img.naturalWidth * (100 - margens.esq - margens.dir) / 100));
      const sh = Math.max(1, Math.round(img.naturalHeight * (100 - margens.topo - margens.base) / 100));
      const escala = Math.min(1, larguraMaxSaida / sw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * escala));
      canvas.height = Math.max(1, Math.round(sh * escala));
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resultadoPendente = canvas.toDataURL('image/jpeg', 0.9);
      instancia?.hide();
    });

    if (instancia) instancia.show(); else modalEl.classList.add('show');
  });
}

function abrirEditorRecorte(arquivo, opcoes = {}) {
  const {
    proporcao = 1,
    larguraSaida = 480,
    circular = false,
    formatoSaida = 'image/jpeg',
  } = opcoes;
  const alturaSaida = Math.round(larguraSaida / proporcao);

  return new Promise(async (resolve) => {
    const seguranca = await verificarImagemSegura(arquivo);
    if (!seguranca.ok) { mostrarToast(seguranca.motivo, 'erro'); resolve(null); return; }
    const larguraViewport = Math.round(Math.min(320, window.innerWidth - 64));
    const alturaViewport = Math.round(larguraViewport / proporcao);

    const modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-prime">
          <div class="modal-header">
            <h2 class="modal-title fs-5 fonte-display">Ajustar imagem</h2>
            <button type="button" class="btn-close" aria-label="Fechar" data-recorte-cancelar></button>
          </div>
          <div class="modal-body text-center">
            <div class="recorte-viewport${circular ? ' recorte-circular' : ''}" style="width:${larguraViewport}px;height:${alturaViewport}px;">
              <img alt="Prévia da imagem a recortar">
            </div>
            <input type="range" class="recorte-zoom-slider mt-3" min="100" max="300" value="100" aria-label="Zoom">
            <p class="texto-suave small mt-2 mb-0">Arraste a imagem para posicionar. Use o controle para aproximar.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-recorte-cancelar>Cancelar</button>
            <button type="button" class="btn-prime" data-recorte-confirmar>Usar esta imagem</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    const viewport = modalEl.querySelector('.recorte-viewport');
    const imgEl = modalEl.querySelector('img');
    const slider = modalEl.querySelector('.recorte-zoom-slider');
    const instancia = window.bootstrap ? new window.bootstrap.Modal(modalEl) : null;

    let escalaBase = 1;   // escala mínima pra cobrir o viewport inteiro (zoom 100% no slider)
    let escalaZoom = 1;   // multiplicador adicional do slider (1x a 3x)
    let offsetX = 0;
    let offsetY = 0;
    let carregada = false;

    function tamanhoExibido() {
      const escalaTotal = escalaBase * escalaZoom;
      return { largura: imgEl.naturalWidth * escalaTotal, altura: imgEl.naturalHeight * escalaTotal, escalaTotal };
    }

    function limitarOffset() {
      const { largura, altura } = tamanhoExibido();
      const maxX = Math.max(0, (largura - larguraViewport) / 2);
      const maxY = Math.max(0, (altura - alturaViewport) / 2);
      offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
      offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
    }

    function redesenhar() {
      const { largura, altura } = tamanhoExibido();
      imgEl.style.width = `${largura}px`;
      imgEl.style.height = `${altura}px`;
      imgEl.style.left = `${(larguraViewport - largura) / 2 + offsetX}px`;
      imgEl.style.top = `${(alturaViewport - altura) / 2 + offsetY}px`;
    }

    imgEl.onload = () => {
      carregada = true;
      // "cover": a escala mínima que faz a imagem cobrir o viewport
      // inteiro nas duas dimensões (a maior das duas razões vence).
      escalaBase = Math.max(larguraViewport / imgEl.naturalWidth, alturaViewport / imgEl.naturalHeight);
      escalaZoom = 1;
      offsetX = 0;
      offsetY = 0;
      slider.value = 100;
      redesenhar();
    };
    imgEl.onerror = () => {
      // Arquivo não é uma imagem de verdade (ou está corrompido) — sem
      // isso, "Confirmar" ficaria clicável mesmo com a imagem nunca tendo
      // carregado, gerando um recorte quebrado (largura/altura zeradas).
      mostrarToast('Não foi possível abrir essa imagem.', 'erro');
      if (instancia) instancia.hide(); else finalizar(null);
    };
    imgEl.src = URL.createObjectURL(arquivo);

    // Arrastar (mouse e toque, via Pointer Events — unifica os dois sem
    // precisar de dois conjuntos de listeners separados).
    let arrastando = false;
    let inicioPointer = { x: 0, y: 0 };
    let inicioOffset = { x: 0, y: 0 };

    viewport.addEventListener('pointerdown', (ev) => {
      if (!carregada) return;
      arrastando = true;
      inicioPointer = { x: ev.clientX, y: ev.clientY };
      inicioOffset = { x: offsetX, y: offsetY };
      viewport.setPointerCapture(ev.pointerId);
    });
    viewport.addEventListener('pointermove', (ev) => {
      if (!arrastando) return;
      offsetX = inicioOffset.x + (ev.clientX - inicioPointer.x);
      offsetY = inicioOffset.y + (ev.clientY - inicioPointer.y);
      limitarOffset();
      redesenhar();
    });
    const pararArraste = () => { arrastando = false; };
    viewport.addEventListener('pointerup', pararArraste);
    viewport.addEventListener('pointercancel', pararArraste);

    slider.addEventListener('input', () => {
      if (!carregada) return;
      escalaZoom = Number(slider.value) / 100;
      limitarOffset();
      redesenhar();
    });

    function finalizar(resultado) {
      URL.revokeObjectURL(imgEl.src);
      modalEl.remove();
      resolve(resultado);
    }

    // Único caminho de finalização de verdade: sempre espera o evento de
    // "modal terminou de fechar" do Bootstrap (dispara tanto por um clique
    // em Cancelar/Confirmar quanto pelo fundo escurecido ou Esc) — em vez
    // de remover o modal direto na hora do clique, o que arriscaria tirar
    // o elemento do DOM enquanto a animação de fechar do Bootstrap ainda
    // estivesse mexendo nele.
    let resultadoPendente = null;
    modalEl.addEventListener('hidden.bs.modal', () => finalizar(resultadoPendente));

    modalEl.querySelectorAll('[data-recorte-cancelar]').forEach(btn => {
      btn.addEventListener('click', () => instancia ? instancia.hide() : finalizar(null));
    });

    modalEl.querySelector('[data-recorte-confirmar]').addEventListener('click', () => {
      if (!carregada) return; // ainda carregando (ou falhou) — nada pra recortar ainda
      const { escalaTotal } = tamanhoExibido();
      // Converte a janela visível (em espaço de tela) de volta pro
      // espaço de pixels ORIGINAIS da imagem, pra recortar do arquivo de
      // verdade (não de uma versão já reduzida na tela).
      const imgLeft = (larguraViewport - imgEl.naturalWidth * escalaTotal) / 2 + offsetX;
      const imgTop = (alturaViewport - imgEl.naturalHeight * escalaTotal) / 2 + offsetY;
      const origemX = -imgLeft / escalaTotal;
      const origemY = -imgTop / escalaTotal;
      const origemLargura = larguraViewport / escalaTotal;
      const origemAltura = alturaViewport / escalaTotal;

      const canvas = document.createElement('canvas');
      canvas.width = larguraSaida;
      canvas.height = alturaSaida;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, origemX, origemY, origemLargura, origemAltura, 0, 0, larguraSaida, alturaSaida);
      resultadoPendente = canvas.toDataURL(formatoSaida, 0.9);

      if (instancia) instancia.hide(); else finalizar(resultadoPendente);
    });

    if (instancia) instancia.show();
  });
}

/* ==========================================================================
   AVATAR — Upload e preview
   ========================================================================== */
function iniciarPreviewAvatar() {
  const input = document.getElementById('inputAvatar');
  const preview = document.getElementById('editarAvatarPreview');
  const gatilho = document.getElementById('btnTrocarAvatar');
  if (!input || !preview) return;

  if (gatilho) gatilho.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const arquivo = input.files[0];
    if (!arquivo) return;

    if (arquivo.size > 2 * 1024 * 1024) {
      mostrarToast('A imagem deve ter no máximo 2MB.', 'erro');
      input.value = '';
      return;
    }

    const recorte = await abrirEditorRecorte(arquivo, {
      proporcao: 1,
      larguraSaida: 480,
      circular: true,
      formatoSaida: 'image/jpeg',
    });
    input.value = '';
    if (!recorte) return; // cancelado no editor

    preview.src = recorte;
    preview.dataset.base64 = recorte;
  });
}

/* ==========================================================================
   PERFIL — Carregar dados da sessão
   ========================================================================== */
async function carregarDadosPerfil() {
  const sessao = await window.db.getSessao();
  if (!sessao) {
    const emTelaDePerfil = /(^|\/)(perfil|editar-perfil)\.html(\?|$)/.test(window.location.pathname);
    if (emTelaDePerfil) {
      window.location.href = 'login.html';
    }
    return;
  }

  const nomeDisplay = document.getElementById('perfilNome');
  const nomeCampo = document.getElementById('perfilNomeCampo');
  const emailDisplay = document.getElementById('perfilEmail');
  const avatarDisplay = document.getElementById('perfilAvatar');
  const nomeEdit = document.getElementById('editarNome');
  const emailEdit = document.getElementById('editarEmail');
  const avatarEdit = document.getElementById('editarAvatarPreview');
  const proximoCard = document.getElementById('perfilProximoAgendamentoCard');
  const proximoDisplay = document.getElementById('perfilProximoAgendamento');
  const acoesCliente = document.getElementById('perfilAcoesCliente');
  const acoesEquipe = document.getElementById('perfilAcoesEquipe');

  preencherTextoCarregado(nomeDisplay, sessao.nome);
  preencherTextoCarregado(nomeCampo, sessao.nome);
  preencherTextoCarregado(emailDisplay, sessao.email);
  if (avatarDisplay) trocarImagemQuandoPronta(avatarDisplay, resolverAsset(sessao.avatar, undefined, TAMANHOS_IMAGEM_CDN.avatarPerfil));
  if (nomeEdit) nomeEdit.value = sessao.nome;
  if (emailEdit) emailEdit.value = sessao.email;
  if (avatarEdit) {
    trocarImagemQuandoPronta(avatarEdit, resolverAsset(sessao.avatar, undefined, TAMANHOS_IMAGEM_CDN.avatarPerfil));
    avatarEdit.dataset.base64 = ''; // só vira data URL quando o usuário escolhe uma foto NOVA
  }

  // O perfil é UMA página só, com seções por nível de conta (cliente,
  // barbeiro comum e barbeiro master). O nível vem da sessão que o servidor
  // acabou de confirmar; esconder/mostrar aqui é organização da tela. Quem
  // impede de verdade um cliente de criar barbeiro, ou um barbeiro comum de
  // mudar o endereço, é o servidor (403 em auth-cadastro.js, config.js,
  // equipe.js...), mesmo que alguém reative os botões pelo navegador.
  const ehEquipe = sessao.papel === 'equipe';
  const ehMaster = ehEquipe && Boolean(sessao.master);
  const ehBarbeiroComum = ehEquipe && !sessao.master;
  aplicarVisibilidadePorPapel({
    cliente: !ehEquipe,
    equipe: ehEquipe,
    master: ehMaster,
    'barbeiro-comum': ehBarbeiroComum,
  });

  if (proximoDisplay && !ehEquipe) {
    const proximo = await window.db.getProximoAgendamento(sessao.usuarioId);
    proximoDisplay.textContent = proximo
      ? `${formatarDataCurta(proximo.data)} às ${proximo.hora} · ${await nomesServicosDoAgendamento(proximo)}`
      : 'Nenhum agendamento futuro.';
  }

  if (ehEquipe && document.getElementById('cartaoEquipe') !== null) {
    iniciarAreaEquipeNoPerfil(sessao);
  }
  // A conta master nunca pode ser excluída (netlify/functions/usuarios.js
  // recusa mesmo se alguém chamar a API direto) — esconder o botão evita
  // mostrar uma ação que vai sempre falhar com erro.
  const btnExcluirConta = document.getElementById('btnExcluirConta');
  if (btnExcluirConta) {
    btnExcluirConta.style.display = sessao.masterRaiz ? 'none' : '';
  }
}

/* ==========================================================================
   EQUIPE: criar barbeiros, pedir/decidir permissões (aba Perfil)
   ========================================================================== */

/**
 * Formulário "Criar conta de barbeiro". Três situações:
 *  - master: escolhe entre barbeiro comum (padrão) e master. Um "?" abre um
 *    pop-up dentro do pop-up explicando a diferença. Escolher master abre um
 *    aviso de riscos OBRIGATÓRIO (é preciso marcar que entendeu) antes de
 *    a conta ser criada;
 *  - barbeiro comum com permissão: só cria barbeiro comum (sem escolha);
 *  - qualquer outro: o botão nem aparece (e o servidor recusaria).
 */
function iniciarCriarContaBarbeiro() {
  const form = document.getElementById('formCriarBarbeiro');
  if (!form || !window.db) return;

  const modalEl = document.getElementById('modalCriarBarbeiro');
  const popupAjuda = document.getElementById('popupExplicaTipos');
  const popupRisco = document.getElementById('popupRiscoMaster');
  const checkRisco = document.getElementById('checkRiscoMaster');
  const btnConfirmarRisco = document.getElementById('btnConfirmarRiscoMaster');
  const btnCancelarRisco = document.getElementById('btnCancelarRiscoMaster');
  const grupoTipo = document.getElementById('grupoTipoBarbeiro');
  const avisoSoComum = document.getElementById('avisoSoBarbeiroComum');

  const abrirPopup = (popup, focoEm) => {
    popup.hidden = false;
    (focoEm || popup.querySelector('button'))?.focus();
  };
  const fecharPopup = (popup) => { popup.hidden = true; };

  document.getElementById('btnAjudaTipos')?.addEventListener('click', () => abrirPopup(popupAjuda, document.getElementById('btnFecharAjudaTipos')));
  document.getElementById('btnFecharAjudaTipos')?.addEventListener('click', () => fecharPopup(popupAjuda));

  // Aviso de risco: o botão de criar só habilita depois de marcar a caixa.
  checkRisco?.addEventListener('change', () => { btnConfirmarRisco.disabled = !checkRisco.checked; });
  btnCancelarRisco?.addEventListener('click', () => {
    fecharPopup(popupRisco);
    checkRisco.checked = false;
    btnConfirmarRisco.disabled = true;
  });

  // Esc fecha o pop-up interno aberto (sem fechar o modal de baixo). No aviso
  // de risco, Esc equivale a "Voltar": cancela, nunca confirma.
  modalEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const aberto = [popupRisco, popupAjuda].find(p => p && !p.hidden);
    if (!aberto) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (aberto === popupRisco) btnCancelarRisco.click(); else fecharPopup(aberto);
  }, true);

  // Ao abrir o modal, mostra só as opções que a conta pode usar.
  modalEl.addEventListener('show.bs.modal', async () => {
    const sessao = await getSessaoAtual();
    const ehMaster = Boolean(sessao?.master);
    mostrarElemento(grupoTipo, ehMaster);
    mostrarElemento(avisoSoComum, !ehMaster);
    const comum = form.querySelector('input[name="tipoBarbeiro"][value="comum"]');
    if (comum) comum.checked = true; // sempre começa no padrão seguro
  });
  modalEl.addEventListener('hidden.bs.modal', () => {
    fecharPopup(popupAjuda);
    fecharPopup(popupRisco);
    if (checkRisco) { checkRisco.checked = false; btnConfirmarRisco.disabled = true; }
    form.reset();
    bpReabilitarBotaoEnvio(form);
  });

  async function criar(master) {
    const nome = document.getElementById('novoBarbeiroNome').value.trim();
    const email = document.getElementById('novoBarbeiroEmail').value.trim();
    const senha = document.getElementById('novoBarbeiroSenha').value;
    const criado = await window.db.criarBarbeiro(nome, email, senha, { master, confirmarRiscoMaster: master });
    if (!criado) return false;
    window.bootstrap?.Modal.getInstance(modalEl)?.hide();
    const primeiroNome = nome.split(' ')[0];
    mostrarToast(master
      ? `Conta master de ${primeiroNome} criada. Ela já pode entrar com a senha combinada.`
      : `Conta de ${primeiroNome} criada. Ela já pode entrar com a senha combinada.`, 'sucesso');
    document.dispatchEvent(new CustomEvent('bp:equipe-alterada'));
    return true;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = document.getElementById('novoBarbeiroNome').value.trim();
    const email = document.getElementById('novoBarbeiroEmail').value.trim();
    const senha = document.getElementById('novoBarbeiroSenha').value;

    if (!nome || !email || senha.length < 6) {
      mostrarToast('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.', 'erro');
      return;
    }
    const querMaster = form.querySelector('input[name="tipoBarbeiro"]:checked')?.value === 'master'
      && !grupoTipo.classList.contains('d-none');

    if (querMaster) {
      // Aviso obrigatório: a conta só é criada depois do "Criar master" do pop-up.
      bpReabilitarBotaoEnvio(form);
      abrirPopup(popupRisco, checkRisco);
      return;
    }
    await criar(false);
  });

  btnConfirmarRisco?.addEventListener('click', async () => {
    if (!checkRisco.checked) return; // o botão já nasce desabilitado; conferência extra
    btnConfirmarRisco.disabled = true;
    try {
      const ok = await criar(true);
      if (!ok) { btnConfirmarRisco.disabled = !checkRisco.checked; }
    } finally {
      fecharPopup(popupRisco);
      checkRisco.checked = false;
    }
  });
}

/**
 * Área de equipe do Perfil:
 *  - barbeiro comum: vê se pode criar barbeiros; se não pode, pede a um master;
 *  - master: aprova/nega pedidos, liga/desliga a permissão de cada barbeiro
 *    comum e (só o master principal) rebaixa outro master.
 */
async function iniciarAreaEquipeNoPerfil(sessao) {
  const btnCriar = document.getElementById('btnCriarContaBarbeiro');

  if (sessao.master) {
    mostrarElemento(btnCriar, true);
    await renderizarEquipeMaster(sessao);
    document.addEventListener('bp:equipe-alterada', () => renderizarEquipeMaster(sessao));
    return;
  }

  // Barbeiro comum
  const texto = document.getElementById('textoPermissaoBarbeiro');
  const btnPedir = document.getElementById('btnSolicitarPermissao');

  async function atualizar() {
    const info = await window.db.getMinhaPermissaoEquipe();
    if (!info) { if (texto) texto.textContent = 'Não foi possível verificar agora.'; return; }
    const pode = Boolean(info.podeCriarBarbeiros);
    mostrarElemento(btnCriar, pode);
    if (pode) {
      texto.textContent = 'Um master liberou você para criar contas de barbeiro comum.';
      btnPedir.classList.add('d-none');
    } else if (info.solicitacao?.status === 'pendente') {
      texto.textContent = 'Pedido enviado. Aguardando um master responder.';
      btnPedir.classList.add('d-none');
    } else {
      texto.textContent = info.solicitacao?.status === 'negada'
        ? 'Seu último pedido foi negado. Você pode pedir de novo.'
        : 'Você ainda não pode criar contas de barbeiro. Peça a um master.';
      btnPedir.classList.remove('d-none');
    }
  }
  btnPedir?.addEventListener('click', async () => {
    btnPedir.disabled = true;
    const ok = await window.db.solicitarPermissaoCriarBarbeiro();
    btnPedir.disabled = false;
    if (ok) mostrarToast('Pedido enviado aos barbeiros master.', 'sucesso');
    await atualizar();
  });
  await atualizar();
}

async function renderizarEquipeMaster(sessao) {
  const listaPedidos = document.getElementById('listaPedidosEquipe');
  const listaMembros = document.getElementById('listaMembrosEquipe');
  const selo = document.getElementById('seloPedidosEquipe');
  if (!listaPedidos || !listaMembros) return;

  const dados = await window.db.getEquipe();
  if (!dados) {
    listaMembros.innerHTML = '<p class="small texto-suave mb-0">Não foi possível carregar a equipe agora.</p>';
    return;
  }

  const pedidos = dados.solicitacoes || [];
  if (selo) {
    selo.textContent = String(pedidos.length);
    selo.classList.toggle('d-none', pedidos.length === 0);
  }
  listaPedidos.innerHTML = pedidos.length
    ? pedidos.map(p => `
        <div class="d-flex align-items-center gap-2 py-2 border-bottom" data-pedido-id="${escaparHtml(p.id)}">
          <div class="flex-grow-1 small"><strong>${escaparHtml(p.nome)}</strong> quer poder criar barbeiros comuns.</div>
          <button type="button" class="btn btn-sm btn-prime" data-decisao="aprovar">Aprovar</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-decisao="negar">Negar</button>
        </div>`).join('')
    : '<p class="small texto-suave mb-0">Nenhum pedido aguardando resposta.</p>';

  const euSouRaiz = Boolean(sessao.masterRaiz);
  listaMembros.innerHTML = (dados.membros || []).map((m) => {
    const ehEu = String(m.id) === String(sessao.usuarioId);
    const etiqueta = m.masterRaiz ? 'Master principal' : (m.master ? 'Master' : 'Barbeiro');
    let acao = '';
    if (!m.master) {
      acao = `<div class="form-check form-switch m-0" title="Pode criar barbeiros comuns">
          <input class="form-check-input" type="checkbox" data-permissao-de="${escaparHtml(m.id)}" ${m.podeCriarBarbeiros ? 'checked' : ''} aria-label="${escaparHtml(m.nome)} pode criar barbeiros">
        </div>`;
    } else if (euSouRaiz && !m.masterRaiz && !ehEu) {
      acao = `<button type="button" class="btn btn-sm btn-outline-danger" data-rebaixar="${escaparHtml(m.id)}">Rebaixar</button>`;
    }
    return `<div class="d-flex align-items-center gap-2 py-2 border-bottom">
        <div class="flex-grow-1 small"><strong>${escaparHtml(m.nome)}</strong>${ehEu ? ' (você)' : ''}<br><span class="texto-suave">${etiqueta}${!m.master && m.podeCriarBarbeiros ? ' · pode criar barbeiros' : ''}</span></div>
        ${acao}
      </div>`;
  }).join('');

  // Um único ouvinte por painel (o painel é redesenhado, os ouvintes ficam no contêiner).
  const cartao = document.getElementById('cartaoEquipe');
  if (cartao && !cartao.dataset.ouvintes) {
    cartao.dataset.ouvintes = '1';
    cartao.addEventListener('click', async (ev) => {
      const btnDecisao = ev.target.closest('[data-decisao]');
      if (btnDecisao) {
        const id = btnDecisao.closest('[data-pedido-id]').dataset.pedidoId;
        btnDecisao.disabled = true;
        const ok = await window.db.decidirSolicitacaoBarbeiro(id, btnDecisao.dataset.decisao);
        if (ok) mostrarToast(btnDecisao.dataset.decisao === 'aprovar' ? 'Permissão concedida.' : 'Pedido negado.', 'sucesso');
        await renderizarEquipeMaster(sessao);
        return;
      }
      const btnRebaixar = ev.target.closest('[data-rebaixar]');
      if (btnRebaixar) {
        if (!window.confirm('Rebaixar este master para barbeiro comum? Ele perde o acesso de master imediatamente.')) return;
        const ok = await window.db.rebaixarMaster(btnRebaixar.dataset.rebaixar);
        if (ok) mostrarToast('Master rebaixado para barbeiro comum.', 'sucesso');
        await renderizarEquipeMaster(sessao);
      }
    });
    cartao.addEventListener('change', async (ev) => {
      const chk = ev.target.closest('[data-permissao-de]');
      if (!chk) return;
      const ok = await window.db.definirPermissaoCriarBarbeiros(chk.dataset.permissaoDe, chk.checked);
      if (ok) mostrarToast(chk.checked ? 'Permissão concedida.' : 'Permissão removida.', 'sucesso');
      await renderizarEquipeMaster(sessao);
    });
  }
}

/**
 * Aviso de pedidos novos para os barbeiros MASTER, em qualquer página do
 * site: confere a cada minuto (só com a aba visível) e avisa com um toast
 * e, se o navegador permitir, uma notificação do sistema. Avisa uma vez por
 * quantidade de pedidos (não repete o mesmo aviso a cada minuto).
 */
async function iniciarAvisoPedidosEquipe() {
  if (!window.db?.getPedidosPendentesEquipe) return;
  const sessao = await getSessaoAtual();
  if (!sessao?.master) return;

  let ultimoAvisado = Number(sessionStorage.getItem('bp-pedidos-avisados') || 0);

  async function conferir() {
    if (document.hidden) return;
    const pendentes = await window.db.getPedidosPendentesEquipe();
    if (pendentes > ultimoAvisado) {
      const texto = pendentes === 1
        ? 'Um barbeiro pediu permissão para criar contas. Veja no seu Perfil.'
        : `${pendentes} barbeiros pediram permissão para criar contas. Veja no seu Perfil.`;
      mostrarToast(texto, 'sucesso');
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Barbear Prime', { body: texto });
        }
      } catch (e) { /* notificação do sistema é um extra; o toast já avisou */ }
    }
    ultimoAvisado = pendentes;
    sessionStorage.setItem('bp-pedidos-avisados', String(pendentes));
  }
  conferir();
  setInterval(conferir, 60 * 1000);
}

/* ==========================================================================
   CALENDÁRIO E HORÁRIOS DINÂMICOS (agendamento)
   ========================================================================== */
function formatarISO(data) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function iniciarCalendarioMock() {
  const grid = document.getElementById('calendarioGrid');
  const corpo = document.getElementById('calendarioCorpo');
  const rotuloMesAno = document.getElementById('calendarioMesAno');
  const grade = document.getElementById('gradeHorarios');
  const btnAnterior = document.getElementById('btnMesAnterior');
  const btnProximo = document.getElementById('btnMesProximo');
  if (!grid || !corpo) return;

  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const hoje = new Date();
  const hojeISO = formatarISO(hoje);

  const ids = JSON.parse(sessionStorage.getItem('bp-servicos-selecionados') || '[]');

  let dataSelecionada = null;
  let mesExibido = hoje.getMonth();
  let anoExibido = hoje.getFullYear();

  async function renderizarHorarios(dataISO) {
    if (!grade) return;

    if (!dataISO) {
      grade.innerHTML = '<p class="texto-suave small mb-0">Selecione um dia no calendário para ver os horários.</p>';
      document.querySelectorAll('#btnConfirmarAgendamento, #btnConfirmarAgendamentoMobile').forEach(b => b.disabled = true);
      return;
    }

    const horarios = window.db && window.db.getHorariosDisponiveis
      ? await window.db.getHorariosDisponiveis(dataISO, ids, window.bpBarbeiroSelecionadoId)
      : [];

    document.getElementById('avisoSlotsDuracao')?.remove();

    if (!horarios.length) {
      grade.innerHTML = '<p class="texto-suave small mb-0">Nenhum horário cadastrado para este dia.</p>';
      return;
    }

    const qtdSlots = window.db?.slotsNecessarios ? await window.db.slotsNecessarios(ids) : 1;
    if (qtdSlots > 1) {
      grade.insertAdjacentHTML('beforebegin', `<p class="texto-suave small mb-2" id="avisoSlotsDuracao">Este agendamento ocupa ${qtdSlots} horários em sequência (duração acima de 60 min).</p>`);
    }

    grade.innerHTML = horarios.map(({ hora, disponivel }) =>
      `<button type="button" class="slot-horario${disponivel ? '' : ' indisponivel'}" data-hora="${hora}"${disponivel ? '' : ' disabled'}>${hora}</button>`
    ).join('');

    document.querySelectorAll('#btnConfirmarAgendamento, #btnConfirmarAgendamentoMobile').forEach(b => b.disabled = true);
  }

  function renderizarCalendario() {
    if (rotuloMesAno) rotuloMesAno.textContent = `${meses[mesExibido]} ${anoExibido}`;

    const primeiroDia = new Date(anoExibido, mesExibido, 1);
    const diasNoMes = new Date(anoExibido, mesExibido + 1, 0).getDate();
    const offsetSemana = primeiroDia.getDay();

    let linhas = '<tr>';
    for (let i = 0; i < offsetSemana; i++) linhas += '<td></td>';

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dataAtual = new Date(anoExibido, mesExibido, dia);
      const dataISO = formatarISO(dataAtual);
      const colunaSemana = (offsetSemana + dia - 1) % 7;
      if (colunaSemana === 0 && dia !== 1) linhas += '</tr><tr>';

      const passado = dataISO < hojeISO;
      const diaSemana = dataAtual.getDay();
      const fechado = diaSemana === 0 || diaSemana === 1; // domingo e segunda: barbearia fechada
      const indisponivel = passado || fechado;
      const classes = ['dia-btn'];
      if (dataISO === hojeISO) classes.push('hoje');
      if (dataISO === dataSelecionada) classes.push('selecionado');
      if (fechado) classes.push('indisponivel');

      linhas += `<td><button class="${classes.join(' ')}" data-data="${dataISO}"${indisponivel ? ' disabled' : ''}${fechado ? ' aria-label="Fechado neste dia"' : ''}>${dia}</button></td>`;
    }
    linhas += '</tr>';
    corpo.innerHTML = linhas;
  }

  grid.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.dia-btn');
    if (!btn || btn.disabled) return;
    dataSelecionada = btn.dataset.data;
    renderizarCalendario();
    await renderizarHorarios(dataSelecionada);
  });

  if (btnAnterior) {
    btnAnterior.addEventListener('click', () => {
      mesExibido--;
      if (mesExibido < 0) { mesExibido = 11; anoExibido--; }
      renderizarCalendario();
    });
  }
  if (btnProximo) {
    btnProximo.addEventListener('click', () => {
      mesExibido++;
      if (mesExibido > 11) { mesExibido = 0; anoExibido++; }
      renderizarCalendario();
    });
  }

  if (grade) {
    grade.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.slot-horario');
      if (!btn || btn.disabled) return;
      grade.querySelectorAll('.slot-horario.selecionado').forEach(b => b.classList.remove('selecionado'));
      btn.classList.add('selecionado');
      document.querySelectorAll('#btnConfirmarAgendamento, #btnConfirmarAgendamentoMobile').forEach(b => b.disabled = false);
    });
  }

  renderizarCalendario();
  renderizarHorarios(null); // síncrono na prática (não chama a API quando dataISO é null)

  // Escolha de barbeiro (feita em iniciarAgendamentoDinamico) muda a
  // disponibilidade de horários — re-renderiza o dia já selecionado.
  window.addEventListener('bp:barbeiro-selecionado', () => {
    if (dataSelecionada) renderizarHorarios(dataSelecionada);
  });
}

/* ==========================================================================
   TEMA E FONTE (preferencias-app.html)
   ========================================================================== */
function iniciarSeletorTema() {
  const btnClaro = document.getElementById('btnTemaClaro');
  const btnEscuro = document.getElementById('btnTemaEscuro');
  if (!btnClaro || !btnEscuro) return;

  function aplicar(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    document.body.setAttribute('data-tema', tema);
    sessionStorage.setItem('bp-tema', tema);
    btnClaro.classList.toggle('active', tema === 'claro');
    btnEscuro.classList.toggle('active', tema === 'escuro');
  }

  btnClaro.addEventListener('click', () => aplicar('claro'));
  btnEscuro.addEventListener('click', () => aplicar('escuro'));
  aplicar(sessionStorage.getItem('bp-tema') || document.body.getAttribute('data-tema') || 'claro');
}

function iniciarSliderFonte() {
  const slider = document.getElementById('sliderFonte');
  if (!slider) return;
  const escalas = { 1: 0.85, 2: 0.92, 3: 1, 4: 1.1, 5: 1.22 };

  const salvo = sessionStorage.getItem('bp-escala-fonte');
  if (salvo) {
    const entrada = Object.entries(escalas).find(([,v]) => String(v) === salvo);
    if (entrada) slider.value = entrada[0];
    document.documentElement.style.setProperty('--escala-fonte', salvo);
  }

  slider.addEventListener('input', () => {
    const escala = escalas[slider.value] ?? 1;
    document.documentElement.style.setProperty('--escala-fonte', escala);
    sessionStorage.setItem('bp-escala-fonte', escala);
  });
}

/* ==========================================================================
   ABAS DE AGENDAMENTOS (meus-agendamentos.html)
   ========================================================================== */
function iniciarAbasAgendamentos() {
  const abas = document.getElementById('agendamentosAbas');
  if (!abas) return;
  abas.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-aba]');
    if (!btn) return;
    abas.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('[data-conteudo-aba]').forEach(el => {
      el.style.display = el.dataset.conteudoAba === btn.dataset.aba ? '' : 'none';
    });
  });
}

async function renderCardAgendamento(agendamento, modoEquipe = false) {
  const servicos = await nomesServicosDoAgendamento(agendamento);
  const total = formatarMoeda(await window.db.calcularTotalAgendamento(agendamento));
  const status = agendamento.status || 'pendente';
  const podeCancelar = status !== 'cancelado';
  const acoesCliente = podeCancelar
    ? `<button type="button" class="btn btn-link btn-sm text-danger p-0 small" data-cancelar-agendamento="${agendamento.id}">Cancelar</button>`
    : '';
  const acoesEquipe = podeCancelar
    ? `<div class="acoes-agendamento-barbeiro">
        ${status === 'pendente' ? `<button type="button" class="btn-acao-agenda" data-acao="confirmar" data-agendamento-id="${agendamento.id}"><i class="bi bi-check-lg"></i> Confirmar</button>` : ''}
        <button type="button" class="btn-acao-agenda" data-acao="remarcar" data-agendamento-id="${agendamento.id}"><i class="bi bi-arrow-repeat"></i> Remarcar</button>
        <button type="button" class="btn-acao-agenda perigo" data-acao="desmarcar" data-agendamento-id="${agendamento.id}" data-status-anterior="${status}"><i class="bi bi-x-lg"></i> Desmarcar</button>
      </div>`
    : '';
  // Foto do cliente que fez o agendamento, como um "dot" — só faz sentido
  // pra quem tem conta (agendamento.usuarioAvatar); walk-ins cadastrados
  // pela própria equipe não têm conta/avatar.
  // IMPORTANTE (segurança): agendamento.usuarioAvatar é a foto de perfil do
  // CLIENTE que fez o agendamento — ou seja, dado escolhido por uma conta
  // de confiança BAIXA (qualquer cliente) e exibido para uma conta de
  // confiança ALTA (a equipe, aqui). escaparHtml() é essencial: sem isso,
  // um cliente poderia gravar um "avatar" malicioso (via chamada direta à
  // API, sem passar pela tela) contendo aspas + atributo tipo onerror="…" e
  // rodar JavaScript arbitrário na sessão logada do barbeiro assim que o
  // painel dele renderizasse este card.
  const dotClienteEquipe = agendamento.usuarioAvatar
    ? `<img src="${escaparHtml(resolverAsset(agendamento.usuarioAvatar, undefined, TAMANHOS_IMAGEM_CDN.dotCliente))}" alt="${escaparHtml(agendamento.usuarioNome || 'Cliente')}" class="avatar-dot-cliente" title="${escaparHtml(agendamento.usuarioNome || 'Cliente')}">`
    : '';

  if (modoEquipe) {
    return `
      <div class="card-prime p-3 mb-2 linha-agendamento-barbeiro" data-agendamento-id="${agendamento.id}">
        <div class="d-flex align-items-center gap-3">
          <div class="text-center" style="min-width:72px;">
            <div class="fw-bold">${escaparHtml(agendamento.hora)}</div>
            <small class="texto-suave">${formatarDataCurta(agendamento.data)}</small>
          </div>
          <div class="flex-grow-1">
            <div class="fw-semibold small">${escaparHtml(servicos)}</div>
            <div class="texto-suave small">${escaparHtml(agendamento.usuarioNome || 'Cliente')}</div>
          </div>
          <span class="badge-status ${escaparHtml(status)}">${escaparHtml(status)}</span>
          ${dotClienteEquipe}
        </div>
        ${acoesEquipe}
      </div>`;
  }

  return `
    <div class="card-prime p-3 mb-2 d-flex flex-row align-items-center gap-3" data-agendamento-id="${agendamento.id}">
      <div class="text-center" style="min-width:72px;">
        <div class="fw-bold">${escaparHtml(agendamento.hora)}</div>
        <small class="texto-suave">${formatarDataCurta(agendamento.data)}</small>
      </div>
      <div class="flex-grow-1">
        <div class="fw-semibold small">${escaparHtml(servicos)}</div>
        <span class="badge-status ${escaparHtml(status)}">${escaparHtml(status)}</span>
      </div>
      <div class="text-end">
        <div class="fw-bold small">${total}</div>
        ${acoesCliente}
      </div>
    </div>`;
}

function listaVazia(texto) {
  return `<div class="card-prime p-4 text-center texto-suave small">${texto}</div>`;
}

async function iniciarAgendamentosCliente() {
  const lista = document.getElementById('agendamentosLista');
  const abas = document.getElementById('agendamentosAbas');
  if (!lista || !abas) return;

  const sessao = await window.db.getSessao();
  if (!sessao) {
    window.location.href = 'login.html';
    return;
  }

  async function renderizar() {
    try {
      await renderizarInterno();
    } catch (e) {
      // Sem isso, um erro de rede deixava a tela presa nos esqueletos de carregamento.
      console.error(e);
      abas.innerHTML = '';
      abas.removeAttribute('aria-busy');
      lista.innerHTML = listaVazia('Não foi possível carregar seus agendamentos agora. Tente novamente em instantes.');
    }
  }

  async function renderizarInterno() {
    const agora = new Date();
    const agendamentos = await window.db.getAgendamentosDoUsuario(sessao.usuarioId);
    const futuros = agendamentos.filter(item => item.status !== 'cancelado' && new Date(`${item.data}T${item.hora}:00`) >= agora);
    const pendentes = agendamentos.filter(item => item.status === 'pendente');
    const historico = agendamentos.filter(item => item.status === 'cancelado' || new Date(`${item.data}T${item.hora}:00`) < agora);

    abas.removeAttribute('aria-busy');
    abas.innerHTML = `
      <li class="nav-item"><button class="nav-link active" data-aba="futuros">Futuros</button></li>
      <li class="nav-item"><button class="nav-link" data-aba="pendentes">Pendentes</button></li>
      <li class="nav-item"><button class="nav-link" data-aba="historico">Histórico</button></li>
    `;

    const [htmlFuturos, htmlPendentes, htmlHistorico] = await Promise.all([
      futuros.length ? Promise.all(futuros.map(item => renderCardAgendamento(item))).then(cards => cards.join('')) : Promise.resolve(listaVazia('Você ainda não tem agendamentos futuros.')),
      pendentes.length ? Promise.all(pendentes.map(item => renderCardAgendamento(item))).then(cards => cards.join('')) : Promise.resolve(listaVazia('Nenhum agendamento pendente.')),
      historico.length ? Promise.all(historico.map(item => renderCardAgendamento(item))).then(cards => cards.join('')) : Promise.resolve(listaVazia('Seu histórico ainda está vazio.')),
    ]);

    lista.innerHTML = `
      <div data-conteudo-aba="futuros">
        <p class="small fw-bold texto-dourado mb-2">Próximos agendamentos</p>
        ${htmlFuturos}
      </div>
      <div data-conteudo-aba="pendentes" style="display:none;">
        <p class="small fw-bold texto-dourado mb-2">Aguardando confirmação</p>
        ${htmlPendentes}
      </div>
      <div data-conteudo-aba="historico" style="display:none;">
        <p class="small fw-bold texto-dourado mb-2">Histórico</p>
        ${htmlHistorico}
      </div>
    `;
  }

  lista.addEventListener('click', async (ev) => {
    const btnCancelar = ev.target.closest('[data-cancelar-agendamento]');
    if (!btnCancelar) return;
    await window.db.cancelarAgendamentoLocal(btnCancelar.dataset.cancelarAgendamento);
    renderizar();
    agendarLembretesDeAgendamento();
  });

  renderizar();

  // Se acabamos de chegar aqui logo depois de criar um agendamento
  // (agendamento.html), oferece "Desfazer" por alguns segundos.
  try {
    const bruto = sessionStorage.getItem('bp-ultimo-agendamento-criado');
    if (bruto) {
      sessionStorage.removeItem('bp-ultimo-agendamento-criado');
      const { id, ts } = JSON.parse(bruto);
      if (id && Date.now() - ts < 15000) {
        mostrarToastComDesfazer('Agendamento confirmado.', 'sucesso', async () => {
          await window.db.cancelarAgendamentoLocal(id);
          renderizar();
          agendarLembretesDeAgendamento();
          mostrarToast('Agendamento desfeito.', 'sucesso');
        });
      }
    }
  } catch (e) { /* sessionStorage indisponível ou dado inválido, ignora */ }
}

/* ==========================================================================
   AGENDA DO BARBEIRO (agendamentos.html)
   ========================================================================== */
function iniciarAgendaBarbeiro() {
  const lista = document.getElementById('listaAgendaBarbeiro');
  if (!lista) return;

  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const hoje = new Date();
  const hojeISO = formatarISO(hoje);

  const grid = document.getElementById('agendaCalendarioGrid');
  const corpo = document.getElementById('agendaCalendarioCorpo');
  const rotuloMesAno = document.getElementById('agendaCalendarioMesAno');
  const btnAnterior = document.getElementById('agendaBtnMesAnterior');
  const btnProximo = document.getElementById('agendaBtnMesProximo');
  const abas = document.getElementById('agendaBarbeiroAbas');
  const tituloDia = document.getElementById('agendaBarbeiroTituloDia');

  let dataSelecionada = hojeISO;
  let mesExibido = hoje.getMonth();
  let anoExibido = hoje.getFullYear();
  let abaAtiva = 'dia';

  /* ------------------------- Calendário (dia da agenda) ------------------------- */
  function renderizarCalendario() {
    if (!grid || !corpo) return;
    if (rotuloMesAno) rotuloMesAno.textContent = `${meses[mesExibido]} ${anoExibido}`;

    const primeiroDia = new Date(anoExibido, mesExibido, 1);
    const diasNoMes = new Date(anoExibido, mesExibido + 1, 0).getDate();
    const offsetSemana = primeiroDia.getDay();

    let linhas = '<tr>';
    for (let i = 0; i < offsetSemana; i++) linhas += '<td></td>';

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dataAtual = new Date(anoExibido, mesExibido, dia);
      const dataISO = formatarISO(dataAtual);
      const colunaSemana = (offsetSemana + dia - 1) % 7;
      if (colunaSemana === 0 && dia !== 1) linhas += '</tr><tr>';

      const classes = ['dia-btn'];
      if (dataISO === hojeISO) classes.push('hoje');
      if (dataISO === dataSelecionada) classes.push('selecionado');

      linhas += `<td><button class="${classes.join(' ')}" data-data="${dataISO}">${dia}</button></td>`;
    }
    linhas += '</tr>';
    corpo.innerHTML = linhas;
  }

  if (grid) {
    grid.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.dia-btn');
      if (!btn) return;
      dataSelecionada = btn.dataset.data;
      abaAtiva = 'dia';
      if (abas) abas.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.abaAgenda === 'dia'));
      renderizarCalendario();
      renderizarLista();
    });
  }
  if (btnAnterior) {
    btnAnterior.addEventListener('click', () => {
      mesExibido--;
      if (mesExibido < 0) { mesExibido = 11; anoExibido--; }
      renderizarCalendario();
    });
  }
  if (btnProximo) {
    btnProximo.addEventListener('click', () => {
      mesExibido++;
      if (mesExibido > 11) { mesExibido = 0; anoExibido++; }
      renderizarCalendario();
    });
  }

  /* ------------------------------------- Abas ------------------------------------ */
  if (abas) {
    abas.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-aba-agenda]');
      if (!btn) return;
      abaAtiva = btn.dataset.abaAgenda;
      abas.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b === btn));
      renderizarLista();
    });
  }

  /* --------------------------------- Lista/render --------------------------------- */
  async function renderizarLista() {
    const agora = new Date();
    const sessaoEquipe = await window.db.getSessao();
    const todosGeral = await window.db.getTodosAgendamentos();
    // Cada barbeiro só vê a própria agenda. Agendamentos antigos sem
    // barbeiroId definido (antes de existir múltiplos barbeiros) continuam
    // visíveis para qualquer conta de equipe, para não "sumir" com eles.
    const todos = todosGeral.filter(item =>
      !item.barbeiroId || Number(item.barbeiroId) === Number(sessaoEquipe?.usuarioId)
    );

    let agendamentos = [];
    let titulo = '';

    if (abaAtiva === 'dia') {
      agendamentos = todos.filter(item => item.data === dataSelecionada && item.status !== 'cancelado');
      titulo = `Agenda de ${formatarDataCurta(dataSelecionada)}`;
    } else if (abaAtiva === 'pendentes') {
      agendamentos = todos.filter(item => item.status === 'pendente');
      titulo = 'Aguardando confirmação';
    } else {
      agendamentos = todos.filter(item =>
        item.status === 'cancelado' || new Date(`${item.data}T${item.hora}:00`) < agora
      );
      titulo = 'Histórico';
    }

    agendamentos = agendamentos.sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`));

    if (tituloDia) tituloDia.textContent = titulo;
    lista.innerHTML = agendamentos.length
      ? (await Promise.all(agendamentos.map(item => renderCardAgendamento(item, true)))).join('')
      : listaVazia('Nenhum atendimento nesta lista.');
  }

  lista.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-acao]');
    if (!btn) return;
    const acao = btn.dataset.acao;
    const id = btn.dataset.agendamentoId;

    if (acao === 'confirmar') {
      const resultado = await window.db.atualizarStatusAgendamentoLocal(id, 'confirmado');
      bpSincronizarMonitorAposAcaoLocal(id, 'confirmado');
      mostrarToast(
        resultado?._offline ? 'Sem conexão: confirmação salva e será enviada quando a internet voltar.' : 'Atendimento confirmado.',
        'sucesso'
      );
      renderizarLista();
    } else if (acao === 'desmarcar') {
      const statusAnterior = btn.dataset.statusAnterior || 'confirmado';
      const linha = btn.closest('.linha-agendamento-barbeiro');
      if (linha) linha.classList.add('saindo');
      const resultado = await window.db.atualizarStatusAgendamentoLocal(id, 'cancelado');
      bpSincronizarMonitorAposAcaoLocal(id, 'cancelado');
      setTimeout(renderizarLista, 220);
      if (resultado?._offline) {
        mostrarToast('Sem conexão: cancelamento salvo e será enviado quando a internet voltar.', 'sucesso');
      } else {
        mostrarToastComDesfazer('Agendamento desmarcado.', 'sucesso', async () => {
          await window.db.atualizarStatusAgendamentoLocal(id, statusAnterior);
          bpSincronizarMonitorAposAcaoLocal(id, statusAnterior);
          renderizarLista();
          mostrarToast('Cancelamento desfeito.', 'sucesso');
        });
      }
    } else if (acao === 'remarcar') {
      abrirModalRemarcar(id);
    }
  });

  /* ----------------------------- Modal: novo agendamento --------------------------- */
  const checklistServicos = document.getElementById('novoAgendamentoServicos');
  const totalServicosLabel = document.getElementById('novoAgendamentoServicosTotal');
  const inputData = document.getElementById('novoAgendamentoData');
  const selectHora = document.getElementById('novoAgendamentoHora');
  const formNovo = document.getElementById('formNovoAgendamentoBarbeiro');

  async function preencherChecklistServicos(container) {
    if (!container || !window.db) return;
    const servicos = await window.db.getServicos();
    container.innerHTML = servicos.map(s => `
      <div class="form-check">
        <input class="form-check-input" type="checkbox" value="${s.id}" id="novoAgendamentoServico-${s.id}">
        <label class="form-check-label small" for="novoAgendamentoServico-${s.id}">
          <span>${escaparHtml(s.nome)}</span>
          <span class="texto-suave">${formatarMoeda(s.preco)}</span>
        </label>
      </div>
    `).join('');
  }

  function getServicosMarcados(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
  }

  async function atualizarTotalServicosMarcados() {
    if (!totalServicosLabel || !window.db) return;
    const ids = getServicosMarcados(checklistServicos);
    if (!ids.length) {
      totalServicosLabel.textContent = '';
      return;
    }
    let total = 0;
    for (const id of ids) {
      const servico = await window.db.getServicoPorId(id);
      total += servico?.preco || 0;
    }
    totalServicosLabel.textContent = `${ids.length} serviço${ids.length > 1 ? 's' : ''} selecionado${ids.length > 1 ? 's' : ''}, total ${formatarMoeda(total)}`;
  }

  async function preencherHorarios(select, dataISO, servicoIds, barbeiroId) {
    if (!select) return;
    if (!dataISO) {
      select.innerHTML = '<option value="">Escolha a data primeiro</option>';
      return;
    }
    const idBarbeiro = barbeiroId || (await window.db.getSessao())?.usuarioId;
    const horarios = await window.db.getHorariosDisponiveis(dataISO, servicoIds || [], idBarbeiro);
    const disponiveis = horarios.filter(h => h.disponivel);
    select.innerHTML = disponiveis.length
      ? disponiveis.map(h => `<option value="${h.hora}">${h.hora}</option>`).join('')
      : '<option value="">Sem horários livres nesse dia</option>';
  }

  if (checklistServicos) {
    preencherChecklistServicos(checklistServicos);
    checklistServicos.addEventListener('change', async () => {
      atualizarTotalServicosMarcados();
      if (inputData?.value) preencherHorarios(selectHora, inputData.value, getServicosMarcados(checklistServicos));
    });
  }
  if (inputData) {
    inputData.min = hojeISO;
    inputData.addEventListener('change', () => preencherHorarios(selectHora, inputData.value, getServicosMarcados(checklistServicos)));
  }

  if (formNovo) {
    formNovo.addEventListener('submit', bpEnvioSeguro(formNovo, async (ev) => {
      ev.preventDefault();
      const nome = document.getElementById('novoAgendamentoCliente').value.trim();
      const servicoIds = getServicosMarcados(checklistServicos);
      const data = inputData.value;
      const hora = selectHora.value;

      if (!nome || !servicoIds.length || !data || !hora) {
        mostrarToast('Preencha cliente, ao menos um serviço, data e horário.', 'erro');
        bpReabilitarBotaoEnvio(formNovo);
        return;
      }

      const criado = await window.db.criarAgendamentoEquipe(nome, servicoIds, data, hora);
      if (criado) {
        bpSincronizarMonitorAposAcaoLocal(criado.id, 'confirmado');
        formNovo.reset();
        preencherChecklistServicos(checklistServicos);
        atualizarTotalServicosMarcados();
        if (selectHora) selectHora.innerHTML = '<option value="">Escolha a data primeiro</option>';
        const modalEl = document.getElementById('modalNovoAgendamentoBarbeiro');
        const instancia = window.bootstrap?.Modal.getInstance(modalEl);
        if (instancia) instancia.hide();
        dataSelecionada = data;
        abaAtiva = 'dia';
        if (abas) abas.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.abaAgenda === 'dia'));
        renderizarCalendario();
        renderizarLista();
      } else {
        bpReabilitarBotaoEnvio(formNovo);
      }
    }));
  }

  /* ------------------------------ Modal: remarcar ---------------------------------- */
  const modalRemarcarEl = document.getElementById('modalRemarcarAgendamento');
  const formRemarcar = document.getElementById('formRemarcarAgendamento');
  const inputRemarcarId = document.getElementById('remarcarAgendamentoId');
  const inputRemarcarData = document.getElementById('remarcarData');
  const selectRemarcarHora = document.getElementById('remarcarHora');

  let remarcarServicoIds = [];

  async function abrirModalRemarcar(id) {
    if (!modalRemarcarEl || !window.bootstrap) return;
    const todosAgendamentos = await window.db.getTodosAgendamentos();
    const agendamento = todosAgendamentos.find(item => Number(item.id) === Number(id));
    remarcarServicoIds = agendamento?.servicoIds || [];
    inputRemarcarId.value = id;
    inputRemarcarData.min = hojeISO;
    inputRemarcarData.value = '';
    selectRemarcarHora.innerHTML = '<option value="">Escolha a data primeiro</option>';
    new window.bootstrap.Modal(modalRemarcarEl).show();
  }

  if (inputRemarcarData) {
    inputRemarcarData.addEventListener('change', () => preencherHorarios(selectRemarcarHora, inputRemarcarData.value, remarcarServicoIds));
  }
  if (formRemarcar) {
    formRemarcar.addEventListener('submit', bpEnvioSeguro(formRemarcar, async (ev) => {
      ev.preventDefault();
      const id = inputRemarcarId.value;
      const novaData = inputRemarcarData.value;
      const novaHora = selectRemarcarHora.value;
      const atualizado = await window.db.remarcarAgendamentoLocal(id, novaData, novaHora);
      if (atualizado) {
        bpSincronizarMonitorAposAcaoLocal(id, 'pendente');
        const instancia = window.bootstrap.Modal.getInstance(modalRemarcarEl);
        if (instancia) instancia.hide();
        renderizarLista();
      } else {
        bpReabilitarBotaoEnvio(formRemarcar);
      }
    }));
  }

  /* ------------------------- Dia de folga / bloquear horário ------------------------- */
  const formFolga = document.getElementById('formDiaDeFolga');
  const inputFolgaData = document.getElementById('folgaData');
  const radioFolgaDia = document.getElementById('folgaTipoDiaInteiro');
  const radioFolgaHora = document.getElementById('folgaTipoHorario');
  const folgaHoraWrap = document.getElementById('folgaHoraWrap');
  const selectFolgaHora = document.getElementById('folgaHora');
  const inputFolgaMotivo = document.getElementById('folgaMotivo');
  const listaFolgaExistente = document.getElementById('folgaListaExistente');
  const modalFolgaEl = document.getElementById('modalDiaDeFolga');

  async function renderizarFolgasExistentes() {
    if (!listaFolgaExistente || !window.db?.getBloqueiosAgenda) return;
    const sessaoEquipe = await window.db.getSessao();
    if (!sessaoEquipe) return;
    const bloqueios = await window.db.getBloqueiosAgenda(sessaoEquipe.usuarioId);
    if (!bloqueios.length) {
      listaFolgaExistente.innerHTML = '<p class="small texto-suave mb-0">Nenhuma folga marcada para os próximos dias.</p>';
      return;
    }
    listaFolgaExistente.innerHTML = `
      <p class="small fw-semibold mb-1">Próximas folgas</p>
      <ul class="list-unstyled small mb-0 d-flex flex-column gap-1">
        ${bloqueios.map(b => `
          <li class="d-flex justify-content-between align-items-center card-prime px-2 py-1">
            <span>${formatarDataCurta(b.data)}${b.hora ? ` às ${b.hora}` : ' (dia inteiro)'}${b.motivo ? ` (${escaparHtml(b.motivo)})` : ''}</span>
            <button type="button" class="btn btn-link btn-sm text-danger p-0" data-remover-folga="${b.id}">Remover</button>
          </li>
        `).join('')}
      </ul>`;
  }

  function atualizarVisibilidadeFolgaHora() {
    if (!folgaHoraWrap) return;
    folgaHoraWrap.style.display = radioFolgaHora?.checked ? '' : 'none';
  }

  if (radioFolgaDia) radioFolgaDia.addEventListener('change', atualizarVisibilidadeFolgaHora);
  if (radioFolgaHora) radioFolgaHora.addEventListener('change', atualizarVisibilidadeFolgaHora);

  if (inputFolgaData) {
    inputFolgaData.min = hojeISO;
    inputFolgaData.addEventListener('change', () => {
      // Passa qtdSlots=1 (só queremos ver quais horários do dia ainda
      // existem/estão livres pra escolher UM horário específico pra
      // bloquear — não é uma reserva de verdade, então não precisa
      // considerar a duração de nenhum serviço).
      preencherHorarios(selectFolgaHora, inputFolgaData.value, []);
    });
  }

  if (modalFolgaEl) {
    modalFolgaEl.addEventListener('show.bs.modal', renderizarFolgasExistentes);
  }

  if (listaFolgaExistente) {
    listaFolgaExistente.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-remover-folga]');
      if (!btn) return;
      const ok = await window.db.removerBloqueioAgenda(btn.dataset.removerFolga);
      if (ok) {
        renderizarFolgasExistentes();
        renderizarLista();
      }
    });
  }

  if (formFolga) {
    formFolga.addEventListener('submit', bpEnvioSeguro(formFolga, async (ev) => {
      ev.preventDefault();
      const data = inputFolgaData.value;
      if (!data) {
        mostrarToast('Escolha uma data.', 'erro');
        bpReabilitarBotaoEnvio(formFolga);
        return;
      }
      const ehHorarioEspecifico = radioFolgaHora?.checked;
      const hora = ehHorarioEspecifico ? selectFolgaHora.value : null;
      if (ehHorarioEspecifico && !hora) {
        mostrarToast('Escolha um horário para bloquear.', 'erro');
        bpReabilitarBotaoEnvio(formFolga);
        return;
      }
      const criado = await window.db.criarBloqueioAgenda(data, hora, inputFolgaMotivo.value.trim());
      if (criado) {
        formFolga.reset();
        atualizarVisibilidadeFolgaHora();
        selectFolgaHora.innerHTML = '<option value="">Escolha a data primeiro</option>';
        await renderizarFolgasExistentes();
        renderizarLista();
        renderizarCalendario();
      } else {
        bpReabilitarBotaoEnvio(formFolga);
      }
    }));
  }

  renderizarCalendario();
  renderizarLista();
}

/* ==========================================================================
   MENU HAMBURGUER
   ========================================================================== */
function iniciarMenuHamburguer() {
  const btn = document.getElementById('btnHamburguer');
  const painel = document.getElementById('menuHamburguerPainel');
  if (!btn || !painel) return;

  function abrir() { painel.classList.add('aberto'); btn.setAttribute('aria-expanded', 'true'); }
  function fechar() { painel.classList.remove('aberto'); btn.setAttribute('aria-expanded', 'false'); }

  btn.addEventListener('click', () => painel.classList.contains('aberto') ? fechar() : abrir());
  painel.addEventListener('click', (ev) => { if (ev.target === painel || ev.target.closest('a')) fechar(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(); });
}

/* ==========================================================================
   VALIDAÇÃO DE FORMULÁRIOS
   ========================================================================== */
function iniciarValidacaoFormularios() {
  document.querySelectorAll('form[novalidate]').forEach(form => {
    const btnEnviar = form.querySelector('button[type="submit"]');

    function validarCampo(campo) {
      let valido = campo.checkValidity();
      if (valido && /confirmarsenha/i.test(campo.id)) {
        const idCampoSenha = campo.id.replace(/confirmarsenha/i, 'Senha');
        const campoSenha = form.querySelector(`#${idCampoSenha}`);
        if (campoSenha && campo.value !== campoSenha.value) valido = false;
      }
      campo.classList.toggle('is-invalid', !valido && (campo.value !== '' || campo.required));
      campo.classList.toggle('is-valid', valido && campo.value !== '');
      return valido;
    }

    form.querySelectorAll('input').forEach(campo => {
      campo.addEventListener('blur', () => validarCampo(campo));
      campo.addEventListener('input', () => {
        if (campo.classList.contains('is-invalid') || campo.classList.contains('is-valid')) validarCampo(campo);
      });
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      let formValido = true;
      form.querySelectorAll('input').forEach(campo => { if (!validarCampo(campo)) formValido = false; });
      if (!formValido) {
        const primeiroInvalido = form.querySelector('.is-invalid');
        if (primeiroInvalido) primeiroInvalido.focus();
        return;
      }
      if (btnEnviar) {
        btnEnviar.disabled = true;
        btnEnviar.dataset.textoOriginal = btnEnviar.innerHTML;
        btnEnviar.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span> Enviando…';
      }
      const mensagem = form.dataset.mensagemSucesso;
      const destino = form.dataset.redirecionar;
      window.setTimeout(() => {
        if (mensagem) mostrarToast(mensagem, 'sucesso');
        if (destino) window.location.href = destino;
      }, mensagem && !destino ? 0 : 500);
    });
  });
}

/**
 * Reabilita um botão de envio deixado em estado "Enviando…" pelo
 * iniciarValidacaoFormularios() após uma chamada à API falhar. Sem isso o
 * botão fica travado (desabilitado, com spinner) para sempre em caso de
 * erro — ex.: senha errada no login, e-mail já cadastrado.
 */
/**
 * Garante que o botão "Enviando…" volte ao normal quando a ação do formulário
 * termina, DÊ CERTO OU NÃO (e mesmo se der exceção). Antes, só os caminhos de
 * erro devolviam o botão; no sucesso ele ficava travado em "Enviando…" para
 * sempre (era o carregamento infinito ao marcar uma folga). Usado nos
 * formulários que continuam na mesma página depois de salvar. Nos de login,
 * cadastro e edição de perfil o sucesso redireciona a página, então o botão
 * fica bloqueado de propósito para impedir clique duplo.
 */
function bpEnvioSeguro(form, acao) {
  return async (ev) => {
    try {
      return await acao(ev);
    } finally {
      bpReabilitarBotaoEnvio(form);
    }
  };
}

function bpReabilitarBotaoEnvio(form) {
  const btn = form?.querySelector('button[type="submit"]');
  if (btn && btn.dataset.textoOriginal) {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.textoOriginal;
  }
}

/* ==========================================================================
   ÂNCORAS INTERNAS (rolagem suave)
   ========================================================================== */
function iniciarAncorasInternas() {
  document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach(link => {
    link.addEventListener('click', (ev) => {
      const alvo = document.querySelector(link.getAttribute('href'));
      if (!alvo) return;
      ev.preventDefault();
      alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      alvo.setAttribute('tabindex', '-1');
      alvo.focus({ preventScroll: true });
    });
  });
}

/* ==========================================================================
   INICIALIZAÇÃO PRINCIPAL
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  // Guard de segurança: páginas de equipe exigem sessão com papel 'equipe'.
  // Se o acesso for negado, o redirecionamento já foi disparado — não
  // inicializa mais nada nesta página para evitar vazar dados/telas.
  if (!(await protegerRotaEquipe())) return;

  // Sempre executar
  aplicarPreferenciasSalvas();
  await padronizarMenus();
  marcarNavAtiva();
  iniciarMenuHamburguer();
  iniciarValidacaoFormularios();
  iniciarAncorasInternas();
  iniciarIndicadorOffline();
  iniciarAvisoPedidosEquipe();

  // CTA "Fazer login / Criar Conta" da Home: só faz sentido pra quem ainda
  // não tem sessão — some assim que já está logado.
  const homeLoginCta = document.getElementById('homeLoginCta');
  if (homeLoginCta && (await getSessaoAtual())) {
    homeLoginCta.style.display = 'none';
  }

  // Inicializa módulos conforme a página
  const pagina = document.body.dataset.paginaAtual || '';

  // Serviços
  if (document.getElementById('listaServicos')) {
    iniciarSelecaoServicos();
  }

  // Agendamento
  if (document.getElementById('chipsServicosSelecionados')) {
    iniciarAgendamentoDinamico();
  }

  // Perfil e edição
  if (document.getElementById('perfilNome') || document.getElementById('editarNome')) {
    carregarDadosPerfil();
  }
  if (document.getElementById('formCriarBarbeiro')) {
    iniciarCriarContaBarbeiro();
  }
  if (document.getElementById('inputAvatar')) {
    iniciarPreviewAvatar();
  }

  // Preferências de corte
  if (document.querySelector('[data-grupo]')) {
    iniciarGruposPreferencia();
    iniciarSalvarPreferenciasCorte();
  }

  // Tema e fonte
  if (document.getElementById('btnTemaClaro')) {
    iniciarSeletorTema();
  }
  if (document.getElementById('sliderFonte')) {
    iniciarSliderFonte();
  }

  // Abas
  if (document.getElementById('agendamentosAbas')) {
    iniciarAgendamentosCliente();
    iniciarAbasAgendamentos();
  }

  // Agenda do barbeiro
  if (document.getElementById('listaAgendaBarbeiro')) {
    iniciarAgendaBarbeiro();
  }

  // Serviços em destaque: edição (Painel do Barbeiro) e exibição (Home)
  if (document.getElementById('gridServicosDestaqueEditavel')) {
    iniciarServicosDestaqueEditavel();
  }
  if (document.getElementById('gridServicosDestaqueHome')) {
    renderizarServicosDestaqueHome();
  }

  // Gerenciar serviços (CRUD): só no Painel do Barbeiro
  if (document.getElementById('listaServicosGerenciar')) {
    iniciarGerenciarServicos();
  }

  // Banner da barbearia: aplica o salvo em qualquer página com a foto de
  // capa, e habilita o upload apenas no Painel do Barbeiro.
  if (document.querySelector('.capa-barbearia')) {
    aplicarBannerSalvo();
  }
  // "Barbearia · Cidade, UF" acompanha o endereço cadastrado
  if (document.getElementById('heroLocalidade')) {
    aplicarRotuloLocalidade();
  }
  if (document.getElementById('faixaValores')) {
    iniciarFaixaValores();
  }
  if (document.getElementById('btnAlterarBanner')) {
    iniciarUploadBanner();
  }

  // Localização (endereço editável só pra equipe)
  if (document.getElementById('enderecoLinha1')) {
    iniciarLocalizacao();
  }

  // Calendário mock
  if (document.getElementById('calendarioGrid')) {
    iniciarCalendarioMock();
  }

  // Notificações (lembretes de agendamento do cliente)
  if (document.getElementById('notifAgendamentos')) {
    iniciarToggleNotificacoes();
  }
  if (document.getElementById('notifOfertas')) {
    iniciarToggleOfertas();
  }
  if (document.getElementById('notifEmailAgendamentos')) {
    iniciarToggleEmailAgendamentos();
  }
  if (document.getElementById('somNotificacao')) {
    iniciarSeletorSomNotificacao();
  }
  if (await getSessaoAtual()) {
    bpAgendarNotificacoesConformePapel();
  }

  // ===== INTEGRAÇÃO COM FORMULÁRIOS DE LOGIN E CADASTRO =====
  // Login (formLogin)
  const formLogin = document.getElementById('formLogin');
  if (formLogin) {
    formLogin.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const senha = document.getElementById('loginSenha').value;
      const usuario = await window.db.login(email, senha);
      if (usuario) {
        if (usuario.papel === 'equipe') {
          window.location.href = 'painel-barbeiro.html';
        } else {
          window.location.href = '../index.html';
        }
      } else {
        bpReabilitarBotaoEnvio(formLogin);
      }
    });
  }

  // Cadastro (formCadastro)
  const formCadastro = document.getElementById('formCadastro');
  if (formCadastro) {
    formCadastro.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nome = document.getElementById('cadNome').value.trim();
      const email = document.getElementById('cadEmail').value.trim();
      const senha = document.getElementById('cadSenha').value;
      const confirmar = document.getElementById('cadConfirmarSenha').value;

      if (senha !== confirmar) {
        mostrarToast('As senhas não coincidem.', 'erro');
        bpReabilitarBotaoEnvio(formCadastro);
        return;
      }
      if (senha.length < 6) {
        mostrarToast('A senha deve ter no mínimo 6 caracteres.', 'erro');
        bpReabilitarBotaoEnvio(formCadastro);
        return;
      }

      const resultado = await window.db.cadastrarUsuario(nome, email, senha, 'cliente');
      if (resultado) {
        // Login automático (auth-cadastro.js já devolve o cookie de
        // sessão) — mesmo comportamento de antes de existir a confirmação
        // por e-mail. A confirmação continua acontecendo em paralelo
        // (best-effort), mas não trava o uso da conta.
        mostrarToast('Cadastro realizado! Mandamos um e-mail de confirmação, mas você já pode usar sua conta normalmente.', 'sucesso');
        setTimeout(() => {
          window.location.href = '../index.html';
        }, 2000);
      } else {
        bpReabilitarBotaoEnvio(formCadastro);
      }
    });
  }

  // Login da equipe (formLoginEquipe)
  const formLoginEquipe = document.getElementById('formLoginEquipe');
  if (formLoginEquipe) {
    formLoginEquipe.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = document.getElementById('equipeUsuario').value.trim();
      const senha = document.getElementById('equipeSenha').value;
      const usuario = await window.db.login(email, senha);
      if (usuario) {
        if (usuario.papel !== 'equipe') {
          mostrarToast('Esta conta é de cliente. Use o login de cliente para entrar.', 'erro');
          await window.db.encerrarSessao();
          bpReabilitarBotaoEnvio(formLoginEquipe);
          return;
        }
        window.location.href = 'painel-barbeiro.html';
      } else {
        bpReabilitarBotaoEnvio(formLoginEquipe);
      }
    });
  }

  // Esqueci minha senha (formEsqueciSenha)
  const formEsqueciSenha = document.getElementById('formEsqueciSenha');
  if (formEsqueciSenha) {
    formEsqueciSenha.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = document.getElementById('esqueciEmail').value.trim();
      const resultado = await window.db.esqueciSenha(email);
      // Resposta sempre "positiva" na forma (ver auth-esqueci-senha.js —
      // de propósito não revela se o e-mail existe ou não), então troca
      // pro aviso genérico independente do conteúdo de `resultado`.
      if (resultado) {
        formEsqueciSenha.style.display = 'none';
        const aviso = document.getElementById('esqueciSenhaEnviado');
        if (aviso) aviso.style.display = 'block';
      } else {
        bpReabilitarBotaoEnvio(formEsqueciSenha);
      }
    });
  }

  // Redefinir senha (formRedefinirSenha) — token vem da URL do e-mail
  const formRedefinirSenha = document.getElementById('formRedefinirSenha');
  if (formRedefinirSenha) {
    const token = new URLSearchParams(window.location.search).get('token');
    const painelInvalido = document.getElementById('redefinirSenhaInvalido');
    if (!token) {
      formRedefinirSenha.style.display = 'none';
      if (painelInvalido) painelInvalido.style.display = 'block';
    } else {
      formRedefinirSenha.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const novaSenha = document.getElementById('redefinirSenha').value;
        const confirmar = document.getElementById('redefinirConfirmarSenha').value;
        if (novaSenha !== confirmar) {
          mostrarToast('As senhas não coincidem.', 'erro');
          bpReabilitarBotaoEnvio(formRedefinirSenha);
          return;
        }
        if (novaSenha.length < 6) {
          mostrarToast('A senha deve ter no mínimo 6 caracteres.', 'erro');
          bpReabilitarBotaoEnvio(formRedefinirSenha);
          return;
        }
        const resultado = await window.db.redefinirSenha(token, novaSenha);
        if (resultado) {
          formRedefinirSenha.style.display = 'none';
          const sucesso = document.getElementById('redefinirSenhaSucesso');
          if (sucesso) sucesso.style.display = 'block';
        } else {
          formRedefinirSenha.style.display = 'none';
          if (painelInvalido) painelInvalido.style.display = 'block';
        }
      });
    }
  }

  // Confirmação de e-mail (sites/verificar-email.html) — roda sozinho ao
  // carregar a página, sem precisar de nenhuma ação da pessoa; o link já
  // chega pronto com o token.
  const painelVerificando = document.getElementById('verificarEmailCarregando');
  if (painelVerificando) {
    const token = new URLSearchParams(window.location.search).get('token');
    const painelSucesso = document.getElementById('verificarEmailSucesso');
    const painelErro = document.getElementById('verificarEmailErro');
    const mensagemErro = document.getElementById('verificarEmailErroMensagem');
    if (!token) {
      painelVerificando.style.display = 'none';
      if (mensagemErro) mensagemErro.textContent = 'Link sem token de confirmação.';
      if (painelErro) painelErro.style.display = 'block';
    } else {
      const resultado = await window.db.verificarEmail(token);
      painelVerificando.style.display = 'none';
      if (resultado) {
        if (painelSucesso) painelSucesso.style.display = 'block';
      } else {
        if (painelErro) painelErro.style.display = 'block';
      }
    }
  }

  // Editar Perfil (formEditarPerfil)
  const formEditarPerfil = document.getElementById('formEditarPerfil');
  if (formEditarPerfil) {
    // O campo "Senha atual" só aparece quando o usuário mexe no e-mail ou na senha.
    const grupoSenhaAtual = document.getElementById('grupoSenhaAtual');
    const atualizarCampoSenhaAtual = async () => {
      const atual = await window.db.getSessao();
      const mudou = Boolean(document.getElementById('editarSenha').value)
        || (atual && document.getElementById('editarEmail').value.trim().toLowerCase() !== atual.email.toLowerCase());
      grupoSenhaAtual?.classList.toggle('d-none', !mudou);
    };
    ['editarEmail', 'editarSenha'].forEach(id => document.getElementById(id)?.addEventListener('input', atualizarCampoSenhaAtual));
    formEditarPerfil.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nome = document.getElementById('editarNome').value.trim();
      const email = document.getElementById('editarEmail').value.trim();
      const senha = document.getElementById('editarSenha').value;
      const confirmar = document.getElementById('editarConfirmarSenha').value;

      if (senha && senha !== confirmar) {
        mostrarToast('As senhas não coincidem.', 'erro');
        bpReabilitarBotaoEnvio(formEditarPerfil);
        return;
      }
      if (senha && senha.length < 6) {
        mostrarToast('A senha deve ter no mínimo 6 caracteres.', 'erro');
        bpReabilitarBotaoEnvio(formEditarPerfil);
        return;
      }

      const avatarPreview = document.getElementById('editarAvatarPreview');
      const avatarBase64 = avatarPreview ? avatarPreview.dataset.base64 : null;
      const senhaAtual = document.getElementById('editarSenhaAtual')?.value || '';

      // Guarda os dados de ANTES da troca para permitir "Desfazer". Só
      // nome e e-mail são revertidos — senha (nunca lida em texto puro de
      // volta) e avatar (já reenviado como URL, não como base64) ficam de
      // fora do desfazer por não terem como ser reconstruídos com segurança.
      const sessaoAntes = await window.db.getSessao();

      // Trocar e-mail ou senha pede a senha atual (o servidor também exige).
      const trocaCredencial = Boolean(senha) || (sessaoAntes && email.toLowerCase() !== sessaoAntes.email.toLowerCase());
      if (trocaCredencial && !senhaAtual) {
        mostrarToast('Informe a sua senha atual para trocar o e-mail ou a senha.', 'erro');
        document.getElementById('editarSenhaAtual')?.focus();
        bpReabilitarBotaoEnvio(formEditarPerfil);
        return;
      }

      const sucesso = await window.db.atualizarPerfil(nome, email, senha, avatarBase64, senhaAtual);
      if (sucesso) {
        let desfeito = false;
        const redirecionar = () => { window.location.href = 'perfil.html'; };
        const temAlteracaoRevertivel = sessaoAntes && (sessaoAntes.nome !== nome || sessaoAntes.email !== email);
        if (temAlteracaoRevertivel) {
          const timer = setTimeout(() => { if (!desfeito) redirecionar(); }, 5200);
          mostrarToastComDesfazer('Dados salvos com sucesso.', 'sucesso', async () => {
            desfeito = true;
            clearTimeout(timer);
            await window.db.atualizarPerfil(sessaoAntes.nome, sessaoAntes.email, '', null, senhaAtual);
            mostrarToast('Alteração desfeita.', 'sucesso');
            redirecionar();
          }, 5000);
        } else {
          mostrarToast('Dados salvos com sucesso.', 'sucesso');
          setTimeout(redirecionar, 2600);
        }
      } else {
        bpReabilitarBotaoEnvio(formEditarPerfil);
      }
    });
  }

  // Excluir conta (botão em perfil.html)
  const btnExcluirConta = document.getElementById('btnExcluirConta');
  if (btnExcluirConta) {
    btnExcluirConta.addEventListener('click', async () => {
      const confirmado = window.confirm('Tem certeza que deseja excluir sua conta? Essa ação não pode ser desfeita.');
      if (!confirmado) return;
      const sucesso = await window.db.excluirConta();
      if (sucesso) window.location.href = '../index.html';
    });
  }

  const btnSairConta = document.getElementById('btnSairConta');
  if (btnSairConta) {
    btnSairConta.addEventListener('click', async () => {
      await window.db.encerrarSessao();
      window.location.href = 'login.html';
    });
  }
});