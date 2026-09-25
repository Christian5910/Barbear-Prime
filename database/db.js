/* ============================================================================
   BARBEAR PRIME — Cliente da API (antes: banco local em localStorage)
   ============================================================================

   Este arquivo mantém os MESMOS NOMES de função que a versão local usava
   (getServicos, login, salvarAgendamentoLocal, etc.) — o que muda é que
   agora cada uma faz uma chamada HTTP para as Netlify Functions em
   netlify/functions/, que por sua vez leem/gravam num Postgres real
   (Neon). Veja database/final/MIGRACAO.md para o histórico dessa migração.

   A versão anterior (100% localStorage, sem backend) continua disponível
   em database/db.local.js, caso você queira rodar o site sozinho, sem
   servidor, como um protótipo/demo offline.

   DIFERENÇA IMPORTANTE PARA QUEM CHAMA ESTE ARQUIVO (ui.js):
   Toda função aqui devolve uma Promise agora (porque HTTP é assíncrono por
   natureza) — mesmo as que antes eram síncronas, como getSessao(). Todo
   lugar que chama window.db.algumaCoisa() precisa usar await.

   Para reduzir a quantidade de "await" espalhados pelo código, dados que
   mudam raramente durante uma sessão de uso (sessão do usuário, catálogo
   de serviços, config geral, lista de barbeiros) ficam guardados em cache
   de memória depois do primeiro carregamento — ver cache{} abaixo. Ações
   de escrita sempre batem no servidor e invalidam o cache correspondente.
   ============================================================================ */

(function criarClienteApi() {
  const BASE_URL = '/api';

  const cache = {
    sessao: undefined, // undefined = ainda não carregado; null = sem sessão
    servicos: null,
    config: null,
    barbeiros: null,
  };

  /* ---------------------------------------------------------------------
     Offline: cache de leituras (localStorage) + fila de sincronização
     ---------------------------------------------------------------------
     GET bem-sucedido: a resposta fica guardada por caminho. Se um GET
     falhar por estarmos SEM CONEXÃO (não por erro do servidor, que já é
     tratado à parte), a última resposta salva é devolvida no lugar de
     quebrar a tela — é assim que "ver agendamentos/perfil offline"
     funciona, de forma genérica, para qualquer leitura.

     Escrita (POST/PUT/DELETE) offline não tem uma forma genérica segura
     de "adivinhar" a resposta do servidor pra qualquer chamada — por
     isso só as ações que fazem sentido guardar pra mais tarde entram na
     fila (ver atualizarPerfil e atualizarStatusAgendamentoLocal). Criar
     algo novo (agendamento, serviço, conta) continua exigindo conexão:
     reconciliar um id "provisório" criado offline com o id real do
     servidor depois é um problema de sincronização bem mais complexo,
     fora do escopo do que foi pedido aqui.
     --------------------------------------------------------------------- */
  const OFFLINE_CACHE_PREFIXO = 'bp-cache-leitura:';
  const OFFLINE_FILA_CHAVE = 'bp-fila-sincronizacao';

  function bpEstaOffline(erro) {
    // requisitar() marca erro.status só quando o servidor de fato
    // respondeu (mesmo que com um erro tipo 404/403/409) — se não tem
    // status, é porque o fetch() em si falhou (sem rede, DNS etc.).
    return Boolean(erro) && erro.status === undefined;
  }

  function bpOfflineSalvarCache(caminho, corpo) {
    try {
      localStorage.setItem(OFFLINE_CACHE_PREFIXO + caminho, JSON.stringify({ corpo, ts: Date.now() }));
    } catch (e) {
      // localStorage indisponível ou cheio — o cache é só um reforço, não
      // impede o resto do site de funcionar.
    }
  }

  function bpOfflineLerCache(caminho) {
    try {
      const bruto = localStorage.getItem(OFFLINE_CACHE_PREFIXO + caminho);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Apaga todo o cache de leitura offline (localStorage).
   * ---------------------------------------------------------------------
   * IMPORTANTE (privacidade em dispositivo compartilhado): esse cache é
   * guardado por CAMINHO da API (ex.: "/agendamentos", "/auth/sessao"),
   * sem nenhuma amarração com QUEM estava logado quando a leitura foi
   * salva. Sem limpar isso no logout, um segundo usuário no mesmo
   * navegador/aparelho (ex.: tablet da recepção da barbearia) que abrisse
   * o app momentaneamente sem internet logo após o primeiro sair podia
   * cair no fallback de "sem conexão, mostra o último dado salvo" (ver
   * requisitar()) e ver os agendamentos/perfil/preferências da PESSOA
   * ANTERIOR, mesmo sem ter feito login como ela. Chamada em
   * encerrarSessao() e excluirConta(), e também no início de login()/
   * cadastrarUsuario() como reforço (cobre o caso de alguém ter fechado a
   * aba sem clicar em "Sair").
   */
  function bpOfflineLimparCacheLeitura() {
    try {
      const chaves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i);
        if (chave && chave.startsWith(OFFLINE_CACHE_PREFIXO)) chaves.push(chave);
      }
      chaves.forEach(chave => localStorage.removeItem(chave));
    } catch (e) {
      // localStorage indisponível — nada a limpar
    }
  }

  /**
   * Atualiza, dentro do cache de leitura de /agendamentos, um agendamento
   * específico com as mudanças passadas — usado pra refletir uma ação
   * feita offline (cancelar, confirmar) na lista que o usuário está vendo,
   * sem esperar a sincronização de verdade.
   */
  function bpOfflineAtualizarAgendamentoCache(id, mudancas) {
    const emCache = bpOfflineLerCache('/agendamentos');
    const lista = emCache?.corpo?.agendamentos;
    if (!Array.isArray(lista)) return null;
    const indice = lista.findIndex(a => String(a.id) === String(id));
    if (indice === -1) return null;
    lista[indice] = { ...lista[indice], ...mudancas };
    bpOfflineSalvarCache('/agendamentos', emCache.corpo);
    return lista[indice];
  }

  function bpFilaLer() {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_FILA_CHAVE) || '[]');
    } catch (e) {
      return [];
    }
  }

  function bpFilaSalvar(fila) {
    try {
      localStorage.setItem(OFFLINE_FILA_CHAVE, JSON.stringify(fila));
    } catch (e) {
      // ignora — pior caso, a fila só vive em memória até recarregar a página
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bp:fila-offline-alterada', { detail: { tamanho: fila.length } }));
    }
  }

  function bpFilaAdicionar(item) {
    const fila = bpFilaLer();
    fila.push({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    bpFilaSalvar(fila);
  }

  function getTamanhoFilaOffline() {
    return bpFilaLer().length;
  }

  /**
   * Reenvia, em ordem, as ações que ficaram pendentes enquanto o app
   * estava offline. Para no primeiro erro de REDE (fetch() lançando —
   * provavelmente ainda sem conexão de verdade): o item continua na fila
   * pra tentar de novo mais tarde. Um item que o servidor recusa de fato
   * (ex.: 409 porque o e-mail escolhido enquanto offline foi ocupado por
   * outra conta nesse meio tempo) é diferente: reenviar exatamente a
   * mesma coisa nunca vai funcionar, e deixá-lo na cabeça da fila
   * travaria pra sempre a sincronização de tudo que veio depois dele.
   * Por isso, HTTP retornando (mesmo com erro) sempre tira o item da
   * fila — mas, se não foi um sucesso (2xx), avisamos com um toast que
   * aquela alteração específica não foi salva, em vez de ficar quieto
   * (antes disso, um item recusado pelo servidor era descartado da fila
   * silenciosamente, e a pessoa nunca ficava sabendo que a edição feita
   * offline tinha se perdido).
   */
  async function bpFilaProcessar() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let fila = bpFilaLer();
    if (!fila.length) return;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bp:sincronizando', { detail: { tamanho: fila.length } }));
    }

    let falhas = 0;
    while (fila.length) {
      const item = fila[0];
      let resposta;
      try {
        resposta = await fetch(`${BASE_URL}${item.caminho}`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: item.metodo,
          body: item.corpo !== undefined ? JSON.stringify(item.corpo) : undefined,
        });
      } catch (e) {
        break; // ainda sem conexão (ou instável) — tenta de novo mais tarde
      }
      if (!resposta.ok) falhas++;
      fila = fila.slice(1);
      bpFilaSalvar(fila);
    }

    if (falhas > 0) {
      emitirToast(
        falhas === 1
          ? 'Uma alteração feita offline não pôde ser salva e foi descartada. Confira e refaça se necessário.'
          : `${falhas} alterações feitas offline não puderam ser salvas e foram descartadas. Confira e refaça se necessário.`,
        'erro'
      );
    }

    // Depois de sincronizar, os dados guardados localmente (ex.: lista de
    // agendamentos) podem estar um pouco atrás da versão real do
    // servidor — as próximas leituras buscam de novo e recachear
    // naturalmente, então não precisa forçar nada aqui.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bp:sincronizacao-concluida', { detail: { restante: fila.length } }));
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', bpFilaProcessar);
    // Cobre o caso de a fila ter ficado pendente de uma visita anterior e
    // a conexão já estar de volta quando o app carrega de novo.
    window.addEventListener('load', () => setTimeout(bpFilaProcessar, 1500));
  }

  async function requisitar(caminho, opcoes = {}) {
    const metodo = (opcoes.method || 'GET').toUpperCase();
    try {
      const resposta = await fetch(`${BASE_URL}${caminho}`, {
        credentials: 'include', // sempre envia o cookie de sessão
        headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
        ...opcoes,
      });

      let corpo = null;
      try {
        corpo = await resposta.json();
      } catch (e) {
        // resposta sem corpo (ex.: 204) — segue com corpo nulo
      }

      if (!resposta.ok) {
        const mensagem = corpo?.erro || `Erro ${resposta.status} ao falar com o servidor.`;
        emitirToast(mensagem, 'erro');
        const erro = new Error(mensagem);
        erro.status = resposta.status;
        // Repassa o corpo inteiro (não só a mensagem) pra quem chamou
        // poder reagir de forma específica a um erro — por exemplo, um
        // campo `codigo` que algum endpoint decida devolver no futuro —
        // sem precisar comparar o texto da mensagem em português.
        erro.corpo = corpo;
        throw erro;
      }

      // /auth/sessao não entra no cache de leitura (ver comentário mais
      // abaixo, no catch, sobre por que esse endpoint nunca usa esse
      // fallback) — não faz sentido guardar um valor que nunca será lido.
      if (metodo === 'GET' && caminho !== '/auth/sessao') bpOfflineSalvarCache(caminho, corpo);
      return corpo;
    } catch (erro) {
      // erro.status definido = o servidor respondeu (com um erro real);
      // já foi tratado (toast mostrado) acima, só repassa.
      if (erro.status !== undefined) throw erro;

      // Chegou aqui: o fetch() em si falhou (sem internet, DNS etc.). Para
      // leituras, tenta devolver a última resposta boa salva localmente
      // em vez de quebrar a tela.
      //
      // EXCEÇÃO IMPORTANTE: /auth/sessao NUNCA usa esse fallback. Esse
      // endpoint é o que decide "quem está logado" — devolver uma resposta
      // antiga do cache aqui significaria, em dispositivo compartilhado,
      // arriscar dizer que a PESSOA ANTERIOR ainda está logada (ou é quem
      // está usando o app agora) só porque a rede caiu bem nesse instante,
      // mesmo sem existir cookie de sessão válido nenhum. Preferimos
      // responder "não sei quem está logado" (getSessao() já trata isso
      // como sem sessão) a arriscar misturar identidade de duas pessoas.
      if (metodo === 'GET' && caminho !== '/auth/sessao') {
        const emCache = bpOfflineLerCache(caminho);
        if (emCache) return emCache.corpo;
      }
      throw erro;
    }
  }

  function emitirToast(mensagem, tipo = 'sucesso') {
    window.dispatchEvent(new CustomEvent('bp:toast', { detail: { mensagem, tipo } }));
  }

  function centavosParaReais(valor) {
    return Math.round(Number(valor) * 100) / 100;
  }

  /* ---------------------------------------------------------------------
     Autenticação e sessão
     --------------------------------------------------------------------- */
  async function carregarSessao() {
    const resultado = await requisitar('/auth/sessao');
    cache.sessao = resultado.usuario
      ? { usuarioId: resultado.usuario.id, nome: resultado.usuario.nome, email: resultado.usuario.email, papel: resultado.usuario.papel, avatar: resultado.usuario.avatar_url, master: Boolean(resultado.usuario.master), masterRaiz: Boolean(resultado.usuario.master_raiz), podeCriarBarbeiros: Boolean(resultado.usuario.pode_criar_barbeiros) }
      : null;
    return cache.sessao;
  }

  async function getSessao() {
    if (cache.sessao === undefined) {
      try {
        await carregarSessao();
      } catch (e) {
        cache.sessao = null;
      }
    }
    return cache.sessao;
  }

  async function cadastrarUsuario(nome, email, senha, papel = 'cliente') {
    try {
      const resultado = await requisitar('/auth/cadastro', {
        method: 'POST',
        body: JSON.stringify({ nome, email, senha, papel }),
      });
      // Login automático só quando é a própria pessoa se cadastrando —
      // mesma condição usada no servidor (auth-cadastro.js só cria cookie
      // de sessão nesse caso). Quando é a equipe criando a conta de um
      // colega (papel === 'equipe'), a resposta não tem cookie nenhum pra
      // gravar: gravar `resultado.usuario` aqui trocaria a sessão de quem
      // está logado (o criador) pela do colega recém-criado, sem ele
      // pedir isso.
      if (papel !== 'equipe') {
        // Reforço de privacidade em dispositivo compartilhado: descarta
        // qualquer cache de leitura de uma sessão anterior neste mesmo
        // navegador antes de gravar a sessão nova.
        bpOfflineLimparCacheLeitura();
        cache.sessao = { usuarioId: resultado.usuario.id, nome: resultado.usuario.nome, email: resultado.usuario.email, papel: resultado.usuario.papel, avatar: resultado.usuario.avatar_url, master: Boolean(resultado.usuario.master) };
      }
      return resultado.usuario;
    } catch (e) {
      return false;
    }
  }

  /**
   * Cria a conta de OUTRO barbeiro (quem chama já precisa estar logado como
   * equipe: master, ou barbeiro comum com permissão). `opcoes.master` pede
   * uma conta master; nesse caso `confirmarRiscoMaster` precisa ser true
   * (a tela só manda depois do aviso obrigatório). O servidor decide se a
   * criação é permitida; esta função só repassa.
   */
  async function criarBarbeiro(nome, email, senha, opcoes = {}) {
    try {
      const corpo = { nome, email, senha, papel: 'equipe' };
      if (opcoes.master) {
        corpo.master = true;
        corpo.confirmarRiscoMaster = opcoes.confirmarRiscoMaster === true;
      }
      const resultado = await requisitar('/auth/cadastro', { method: 'POST', body: JSON.stringify(corpo) });
      return resultado.usuario;
    } catch (e) {
      return false;
    }
  }

  async function verificarEmail(token) {
    try {
      return await requisitar('/auth/verificar-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
    } catch (e) {
      return false;
    }
  }

  async function esqueciSenha(email) {
    try {
      return await requisitar('/auth/esqueci-senha', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    } catch (e) {
      return false;
    }
  }

  async function redefinirSenha(token, novaSenha) {
    try {
      return await requisitar('/auth/resetar-senha', {
        method: 'POST',
        body: JSON.stringify({ token, novaSenha }),
      });
    } catch (e) {
      return false;
    }
  }

  async function login(email, senha) {
    try {
      const resultado = await requisitar('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha }),
      });
      // Mesmo reforço de privacidade do cadastro: descarta qualquer cache
      // de leitura de uma sessão anterior neste navegador antes de gravar
      // a sessão de quem acabou de entrar.
      bpOfflineLimparCacheLeitura();
      cache.sessao = { usuarioId: resultado.usuario.id, nome: resultado.usuario.nome, email: resultado.usuario.email, papel: resultado.usuario.papel, avatar: resultado.usuario.avatar_url, master: Boolean(resultado.usuario.master) };
      return resultado.usuario;
    } catch (e) {
      return false;
    }
  }

  async function encerrarSessao() {
    try {
      await requisitar('/auth/logout', { method: 'POST' });
    } finally {
      cache.sessao = null;
      bpOfflineLimparCacheLeitura();
    }
    return true;
  }

  async function usuarioLogado() {
    return Boolean(await getSessao());
  }

  async function atualizarPerfil(nome, email, senha, avatarBase64, senhaAtual) {
    const sessao = await getSessao();
    if (!sessao) return false;
    try {
      const payload = { nome, email };
      if (senha) payload.senha = senha;
      // Trocar senha ou e-mail exige a senha atual (o servidor confere).
      if (senhaAtual) payload.senhaAtual = senhaAtual;
      // Só sobe foto quando há uma imagem NOVA (data URL gerada pelo recorte).
      // Antes, salvar só o nome reenviava a URL do avatar atual como se fosse
      // o conteúdo da imagem, e o servidor respondia "o arquivo enviado não
      // parece ser uma imagem válida".
      const temFotoNova = typeof avatarBase64 === 'string' && avatarBase64.startsWith('data:image/');
      if (temFotoNova) {
        const url = await enviarUpload('avatar', 'avatar.jpg', 'image/jpeg', avatarBase64);
        payload.avatarUrl = url;
      }
      const resultado = await requisitar(`/usuarios/${sessao.usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      cache.sessao = { ...sessao, nome: resultado.usuario.nome, email: resultado.usuario.email, avatar: resultado.usuario.avatar_url };
      emitirToast('Perfil atualizado.', 'sucesso');
      return resultado.usuario;
    } catch (e) {
      // Só nome/e-mail entram na fila offline. Senha não fica guardada em
      // texto puro esperando conexão, e foto exige upload de verdade (não
      // tem como acontecer sem rede) — os dois casos pedem tentar de novo
      // já conectado, em vez de enfileirar.
      if (bpEstaOffline(e) && !senha && !(typeof avatarBase64 === 'string' && avatarBase64.startsWith('data:image/')) && email === sessao.email) {
        cache.sessao = { ...sessao, nome, email };
        bpFilaAdicionar({ caminho: `/usuarios/${sessao.usuarioId}`, metodo: 'PUT', corpo: { nome, email } });
        emitirToast('Sem conexão: dados salvos e serão enviados quando a internet voltar.', 'sucesso');
        return { ...sessao, nome, email, _offline: true };
      }
      if (bpEstaOffline(e)) {
        emitirToast('Sem conexão: tente novamente quando a internet voltar.', 'erro');
      }
      return false;
    }
  }

  async function excluirConta() {
    const sessao = await getSessao();
    if (!sessao) return false;
    try {
      await requisitar(`/usuarios/${sessao.usuarioId}`, { method: 'DELETE' });
      cache.sessao = null;
      bpOfflineLimparCacheLeitura();
      emitirToast('Conta excluída.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Serviços
     --------------------------------------------------------------------- */
  async function getServicos() {
    if (!cache.servicos) {
      const resultado = await requisitar('/servicos');
      cache.servicos = resultado.servicos;
    }
    return cache.servicos;
  }

  async function getServicoPorId(id) {
    const servicos = await getServicos();
    return servicos.find(s => s.id === String(id)) || null;
  }

  function invalidarCacheServicos() {
    cache.servicos = null;
    window.dispatchEvent(new CustomEvent('bp:servicos-alterados'));
  }

  async function criarServico(dados) {
    try {
      await requisitar('/servicos', { method: 'POST', body: JSON.stringify(dados) });
      invalidarCacheServicos();
      emitirToast('Serviço criado.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  async function atualizarServico(id, dados) {
    try {
      await requisitar(`/servicos/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
      invalidarCacheServicos();
      emitirToast('Serviço atualizado. Agendamentos já marcados mantêm o valor original.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  async function excluirServico(id) {
    try {
      await requisitar(`/servicos/${id}`, { method: 'DELETE' });
      invalidarCacheServicos();
      emitirToast('Serviço removido.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  async function calcularTotal(servicoIds) {
    const servicos = await getServicos();
    return (servicoIds || []).reduce((total, id) => {
      const s = servicos.find(item => item.id === String(id));
      return total + (s ? s.preco : 0);
    }, 0);
  }

  async function calcularTotalAgendamento(agendamento) {
    if (Array.isArray(agendamento?.servicosSnapshot) && agendamento.servicosSnapshot.length) {
      return agendamento.servicosSnapshot.reduce((total, s) => total + (Number(s.preco) || 0), 0);
    }
    return calcularTotal(agendamento?.servicoIds || []);
  }

  async function nomesServicosAgendamento(agendamento) {
    if (Array.isArray(agendamento?.servicosSnapshot) && agendamento.servicosSnapshot.length) {
      return agendamento.servicosSnapshot.map(s => s.nome).filter(Boolean);
    }
    const servicos = await getServicos();
    return (agendamento?.servicoIds || [])
      .map(id => servicos.find(s => s.id === String(id))?.nome)
      .filter(Boolean);
  }

  /* ---------------------------------------------------------------------
     Serviços em destaque e configuração geral (banner)
     --------------------------------------------------------------------- */
  async function getServicosDestaque() {
    const servicos = await getServicos();
    const destacados = servicos.filter(s => s.destaque).map(s => s.id);
    if (destacados.length) return destacados;
    const config = await getConfig();
    if (config.servicos_destaque_vazio === 'true') return [];
    return servicos.slice(0, 4).map(s => s.id);
  }

  async function salvarServicosDestaque(idsServicos) {
    // O back-end marca destaque=true/false diretamente na tabela de
    // serviços — atualiza um a um para refletir a seleção completa.
    const servicos = await getServicos();
    const novosIds = new Set((idsServicos || []).slice(0, 4));
    try {
      await Promise.all(servicos.map(s => {
        const deveSerDestaque = novosIds.has(s.id);
        if (deveSerDestaque === s.destaque) return null;
        return requisitar(`/servicos/${s.id}`, { method: 'PUT', body: JSON.stringify({ destaque: deveSerDestaque }) });
      }));
      // Guarda se o barbeiro esvaziou a seleção de propósito, pra não cair
      // de volta nos 4 primeiros serviços automaticamente da próxima vez.
      await salvarConfig('servicos_destaque_vazio', novosIds.size === 0 ? 'true' : 'false');
      invalidarCacheServicos();
      emitirToast('Serviços em destaque atualizados.', 'sucesso');
      return Array.from(novosIds);
    } catch (e) {
      return false;
    }
  }

  async function getConfig() {
    if (!cache.config) {
      const resultado = await requisitar('/config');
      cache.config = resultado.config;
    }
    return cache.config;
  }

  async function salvarConfig(chave, valor) {
    try {
      await requisitar('/config', { method: 'PUT', body: JSON.stringify({ chave, valor }) });
      cache.config = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  function blocosInfoPadrao(config) {
    // Compatibilidade: bancos antigos guardavam horário e telefone em
    // chaves soltas (endereco_horario / endereco_telefone) antes da lista
    // editável de blocos existir. Só usamos esses valores se realmente
    // estiverem salvos no banco; nenhum texto de exemplo é inventado aqui,
    // porque toda informação exibida deve vir do banco de dados.
    const blocos = [];
    if (config.endereco_horario) {
      blocos.push({ id: 'horario', icone: null, iconeBootstrap: 'bi-clock', texto: config.endereco_horario });
    }
    if (config.endereco_telefone) {
      blocos.push({ id: 'telefone', icone: null, iconeBootstrap: 'bi-telephone', texto: config.endereco_telefone });
    }
    return blocos;
  }

  const SIGLAS_UF = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  ];

  /**
   * Extrai "Cidade, UF" de um texto de endereço, como o da linha 2
   * ("Bairro dos Perus, Xique-Xique, BA") ou o termo de busca do mapa.
   * Aceita "Cidade, UF", "Cidade - UF" e "Cidade/UF". Se não achar uma
   * sigla de estado válida, usa o último trecho depois da vírgula como
   * cidade. Devolve '' quando não dá para saber (ex.: só o nome do bairro).
   */
  function extrairCidadeUf(texto) {
    const partes = String(texto || '').split(',').map(p => p.trim()).filter(Boolean);
    if (!partes.length) return '';

    const ultimo = partes[partes.length - 1];

    // "Cidade - UF" ou "Cidade/UF" no último trecho
    const composto = /^(.+?)\s*[-–\/]\s*([A-Za-z]{2})$/.exec(ultimo);
    if (composto && SIGLAS_UF.includes(composto[2].toUpperCase())) {
      return `${composto[1].trim()}, ${composto[2].toUpperCase()}`;
    }

    if (partes.length < 2) return '';

    // "..., Cidade, UF"
    if (SIGLAS_UF.includes(ultimo.toUpperCase()) && partes.length >= 2) {
      return `${partes[partes.length - 2]}, ${ultimo.toUpperCase()}`;
    }

    // Sem sigla de estado: assume que o último trecho é a cidade.
    return ultimo;
  }

  async function getEnderecoBarbearia() {
    const config = await getConfig();
    let infoBlocos;
    try {
      infoBlocos = config.localizacao_info_blocos ? JSON.parse(config.localizacao_info_blocos) : null;
    } catch (e) {
      infoBlocos = null;
    }
    const linha2 = config.endereco_linha2 || '';
    const mapaBusca = config.endereco_mapa_busca || '';
    return {
      linha1: config.endereco_linha1 || '',
      linha2,
      cep: config.endereco_cep || '',
      numero: config.endereco_numero || '',
      mapaBusca,
      // "Cidade, UF" derivado do endereço cadastrado (linha 2 primeiro,
      // depois o termo do mapa). É o que aparece em "Barbearia · Cidade, UF"
      // na Home e no Painel, então sempre acompanha o que o master salvar.
      localidade: extrairCidadeUf(linha2) || extrairCidadeUf(mapaBusca),
      infoBlocos: Array.isArray(infoBlocos) ? infoBlocos : blocosInfoPadrao(config),
    };
  }

  async function salvarEnderecoBarbearia(dados) {
    try {
      await Promise.all([
        salvarConfig('endereco_linha1', dados.linha1 || ''),
        salvarConfig('endereco_linha2', dados.linha2 || ''),
        salvarConfig('endereco_cep', dados.cep || ''),
        salvarConfig('endereco_numero', dados.numero || ''),
        salvarConfig('endereco_mapa_busca', dados.mapaBusca || ''),
        salvarConfig('localizacao_info_blocos', JSON.stringify(dados.infoBlocos || [])),
      ]);
      cache.config = null;
      emitirToast('Localização atualizada.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Busca um CEP na API pública do ViaCEP (gratuita, sem necessidade de
   * chave). Retorna null se o CEP não existir ou a busca falhar (sem
   * internet, por exemplo) — quem chamar decide como avisar o usuário.
   */
  async function buscarCep(cep) {
    const cepLimpo = String(cep || '').replace(/\D/g, '');
    if (cepLimpo.length !== 8) return null;
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const dados = await resposta.json();
      if (!resposta.ok || dados.erro) return null;
      return {
        logradouro: dados.logradouro || '',
        bairro: dados.bairro || '',
        cidade: dados.localidade || '',
        uf: dados.uf || '',
      };
    } catch (e) {
      return null;
    }
  }

  const AJUSTES_BANNER = ['proporcao', 'recorte', 'tamanho-original', 'padrao'];

  /** Como a capa da Home é exibida. Valores antigos ('original'/'cortar') são traduzidos. */
  async function getAjusteBanner() {
    const config = await getConfig();
    const v = config.banner_barbearia_ajuste;
    if (v === 'original') return 'proporcao';
    if (v === 'cortar') return 'padrao';
    return AJUSTES_BANNER.includes(v) ? v : 'padrao';
  }

  /**
   * Os destaques logo abaixo da capa da Home ("Desde 2016..."). Devolve a
   * lista [{ titulo, texto }] salva no banco, ou null se ainda não houver.
   */
  async function getFaixaValores() {
    const config = await getConfig();
    if (!config.home_faixa_valores) return null;
    try {
      const lista = JSON.parse(config.home_faixa_valores);
      return Array.isArray(lista) ? lista : null;
    } catch (e) {
      return null;
    }
  }

  async function salvarFaixaValores(itens) {
    return salvarConfig('home_faixa_valores', JSON.stringify(itens));
  }

  async function getBannerBarbearia() {
    const config = await getConfig();
    return config.banner_barbearia_url || null;
  }

  async function salvarBannerBarbearia(base64, ajuste) {
    try {
      const url = await enviarUpload('banner', 'banner.jpg', 'image/jpeg', base64);
      // Grava como a capa deve ser exibida. Se este passo falhar, a imagem
      // nova já subiu; o ajuste antigo continua valendo até a próxima troca.
      if (ajuste) await salvarConfig('banner_barbearia_ajuste', ajuste);
      cache.config = null;
      window.dispatchEvent(new CustomEvent('bp:banner-alterado', { detail: url }));
      emitirToast('Foto de capa atualizada.', 'sucesso');
      return url;
    } catch (e) {
      return false;
    }
  }

  async function enviarIconeInfoLocalizacao(base64) {
    try {
      return await enviarUpload('icone', 'icone.png', 'image/png', base64);
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Barbeiros
     --------------------------------------------------------------------- */
  async function getBarbeiros() {
    if (!cache.barbeiros) {
      const resultado = await requisitar('/barbeiros');
      cache.barbeiros = resultado.barbeiros;
    }
    return cache.barbeiros;
  }

  async function getBarbeiroPorId(id) {
    const barbeiros = await getBarbeiros();
    return barbeiros.find(b => String(b.id) === String(id)) || null;
  }

  /* ---------------------------------------------------------------------
     Agendamentos
     --------------------------------------------------------------------- */
  function normalizarAgendamento(a) {
    return {
      ...a,
      servicosSnapshot: (a.servicosSnapshot || []).map(s => ({ ...s, preco: centavosParaReais(s.preco) })),
    };
  }

  async function getTodosAgendamentos() {
    try {
      const resultado = await requisitar('/agendamentos');
      return (resultado.agendamentos || []).map(normalizarAgendamento);
    } catch (e) {
      return [];
    }
  }

  async function getAgendamentosDoUsuario(usuarioId) {
    const todos = await getTodosAgendamentos();
    return todos.filter(a => String(a.usuarioId) === String(usuarioId));
  }

  async function getProximoAgendamento(usuarioId) {
    const agora = Date.now();
    const meus = await getAgendamentosDoUsuario(usuarioId);
    return meus
      .filter(a => a.status !== 'cancelado' && new Date(`${a.data}T${a.hora}:00`).getTime() >= agora)
      .sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`))[0] || null;
  }

  async function getHorariosDisponiveis(data, servicoIds, barbeiroId) {
    const params = new URLSearchParams({ data });
    if (servicoIds?.length) params.set('servicoIds', servicoIds.join(','));
    if (barbeiroId) params.set('barbeiroId', barbeiroId);
    try {
      const resultado = await requisitar(`/horarios-disponiveis?${params.toString()}`);
      return resultado.horarios;
    } catch (e) {
      return [];
    }
  }

  async function slotsNecessarios(servicoIds) {
    const servicos = await getServicos();
    const duracaoTotal = (servicoIds || []).reduce((soma, id) => {
      const s = servicos.find(item => item.id === String(id));
      return soma + (s?.duracaoMin || 30);
    }, 0);
    return Math.max(1, Math.ceil(duracaoTotal / 60));
  }

  async function salvarAgendamentoLocal(servicoIds, data, hora, barbeiroId) {
    try {
      const resultado = await requisitar('/agendamentos', {
        method: 'POST',
        body: JSON.stringify({ servicoIds, data, hora, barbeiroId }),
      });
      emitirToast('Agendamento salvo.', 'sucesso');
      return normalizarAgendamento(resultado.agendamento);
    } catch (e) {
      return false;
    }
  }

  async function criarAgendamentoEquipe(nomeCliente, servicoIds, data, hora) {
    try {
      const resultado = await requisitar('/agendamentos', {
        method: 'POST',
        body: JSON.stringify({ servicoIds, data, hora, clienteNome: nomeCliente }),
      });
      emitirToast('Agendamento criado.', 'sucesso');
      return normalizarAgendamento(resultado.agendamento);
    } catch (e) {
      return false;
    }
  }

  async function remarcarAgendamentoLocal(id, novaData, novaHora) {
    try {
      const resultado = await requisitar(`/agendamentos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ acao: 'remarcar', data: novaData, hora: novaHora }),
      });
      emitirToast('Agendamento remarcado.', 'sucesso');
      return normalizarAgendamento(resultado.agendamento);
    } catch (e) {
      return false;
    }
  }

  async function atualizarStatusAgendamentoLocal(id, status) {
    try {
      const resultado = await requisitar(`/agendamentos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ acao: 'status', status }),
      });
      return normalizarAgendamento(resultado.agendamento);
    } catch (e) {
      if (bpEstaOffline(e)) {
        const atualizado = bpOfflineAtualizarAgendamentoCache(id, { status });
        if (atualizado) {
          bpFilaAdicionar({ caminho: `/agendamentos/${id}`, metodo: 'PUT', corpo: { acao: 'status', status } });
          // _offline marca que isso é uma atualização otimista local (a
          // ação real ainda não chegou no servidor) — quem chama decide
          // como avisar o usuário disso.
          return { ...normalizarAgendamento(atualizado), _offline: true };
        }
      }
      return false;
    }
  }

  async function cancelarAgendamentoLocal(id) {
    const resultado = await atualizarStatusAgendamentoLocal(id, 'cancelado');
    if (resultado) {
      emitirToast(
        resultado._offline
          ? 'Sem conexão: cancelamento salvo e será enviado quando a internet voltar.'
          : 'Agendamento cancelado.',
        'sucesso'
      );
    }
    return resultado;
  }

  /* ---------------------------------------------------------------------
     Bloqueios de agenda (dia de folga / horário específico)
     --------------------------------------------------------------------- */
  async function getBloqueiosAgenda(barbeiroId, data) {
    try {
      const qs = data ? `?barbeiroId=${barbeiroId}&data=${data}` : `?barbeiroId=${barbeiroId}`;
      const resultado = await requisitar(`/bloqueios-agenda${qs}`);
      return resultado.bloqueios || [];
    } catch (e) {
      return [];
    }
  }

  async function criarBloqueioAgenda(data, hora, motivo) {
    try {
      const resultado = await requisitar('/bloqueios-agenda', {
        method: 'POST',
        body: JSON.stringify({ data, hora: hora || null, motivo: motivo || null }),
      });
      emitirToast(hora ? 'Horário bloqueado.' : 'Dia de folga marcado.', 'sucesso');
      return resultado.bloqueio;
    } catch (e) {
      return false;
    }
  }

  async function removerBloqueioAgenda(id) {
    try {
      await requisitar(`/bloqueios-agenda?id=${id}`, { method: 'DELETE' });
      emitirToast('Bloqueio removido.', 'sucesso');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Preferências de corte
     --------------------------------------------------------------------- */
  async function getPreferenciasCorte(usuarioId) {
    try {
      const resultado = await requisitar(`/preferencias-corte/${usuarioId}`);
      return resultado.preferencias || {};
    } catch (e) {
      return {};
    }
  }

  async function salvarPreferenciasCorte(usuarioId, preferenciasUsuario) {
    try {
      const resultado = await requisitar(`/preferencias-corte/${usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify(preferenciasUsuario),
      });
      emitirToast('Preferências salvas.', 'sucesso');
      return resultado.preferencias;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Notificações
     --------------------------------------------------------------------- */
  async function getPreferenciasNotificacaoCompletas(usuarioId) {
    try {
      const resultado = await requisitar(`/notificacoes/${usuarioId}`);
      return resultado.preferencias;
    } catch (e) {
      return { notifAgendamentos: true, notifOfertas: false, notifEmailAgendamentos: false, somNotificacao: 'padrao', somPersonalizado: null };
    }
  }

  async function getPreferenciaNotificacoes() {
    const sessao = await getSessao();
    if (!sessao) return true;
    const prefs = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    return prefs.notifAgendamentos !== false;
  }

  async function getPreferenciaOfertas() {
    const sessao = await getSessao();
    if (!sessao) return false;
    const prefs = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    return Boolean(prefs.notifOfertas);
  }

  async function salvarPreferenciaOfertas(ativado) {
    const sessao = await getSessao();
    if (!sessao) return false;
    const atuais = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    try {
      await requisitar(`/notificacoes/${sessao.usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...atuais, notifOfertas: ativado }),
      });
      return ativado;
    } catch (e) {
      return false;
    }
  }

  async function salvarPreferenciaNotificacoes(ativado) {
    const sessao = await getSessao();
    if (!sessao) return false;
    const atuais = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    try {
      await requisitar(`/notificacoes/${sessao.usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...atuais, notifAgendamentos: ativado }),
      });
      return ativado;
    } catch (e) {
      return false;
    }
  }

  // Só tem efeito pra conta de equipe: o próprio barbeiro recebendo um
  // e-mail (via Resend) sempre que um cliente marca um horário com ele —
  // ver netlify/functions/agendamentos.js. Desligado por padrão, cada
  // barbeiro ativa pela própria tela de Preferências.
  async function getPreferenciaEmailAgendamentos() {
    const sessao = await getSessao();
    if (!sessao) return false;
    const prefs = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    return Boolean(prefs.notifEmailAgendamentos);
  }

  async function salvarPreferenciaEmailAgendamentos(ativado) {
    const sessao = await getSessao();
    if (!sessao) return false;
    const atuais = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    try {
      await requisitar(`/notificacoes/${sessao.usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...atuais, notifEmailAgendamentos: ativado }),
      });
      return ativado;
    } catch (e) {
      return false;
    }
  }

  async function getSomNotificacao() {
    const sessao = await getSessao();
    if (!sessao) return 'padrao';
    const prefs = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    return prefs.somNotificacao;
  }

  async function salvarSomNotificacao(som) {
    const sessao = await getSessao();
    if (!sessao) return 'padrao';
    const atuais = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    try {
      await requisitar(`/notificacoes/${sessao.usuarioId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...atuais, somNotificacao: som }),
      });
      return som;
    } catch (e) {
      return 'padrao';
    }
  }

  async function getSomPersonalizado() {
    const sessao = await getSessao();
    if (!sessao) return null;
    const prefs = await getPreferenciasNotificacaoCompletas(sessao.usuarioId);
    return prefs.somPersonalizado;
  }

  async function salvarSomPersonalizado(dataUrl, nomeArquivo) {
    try {
      const [, mimeType, base64] = dataUrl.match(/^data:(.+?);base64,(.+)$/) || [];
      const url = await enviarUpload('som', nomeArquivo, mimeType || 'audio/mpeg', base64);
      return { url, nomeArquivo };
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------------------
     Upload de arquivos (ImageKit, via /api/upload)
     --------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------
     Equipe: permissões e pedidos (ver netlify/functions/equipe.js)
     --------------------------------------------------------------------- */
  async function getEquipe() {
    try { return await requisitar('/equipe'); } catch (e) { return null; }
  }

  // Usada só no aviso periódico: silenciosa, sem toast de erro.
  async function getPedidosPendentesEquipe() {
    try {
      const r = await fetch(`${BASE_URL}/equipe/resumo`, { credentials: 'include' });
      if (!r.ok) return 0;
      const corpo = await r.json();
      return Number(corpo.pendentes) || 0;
    } catch (e) {
      return 0;
    }
  }

  async function getMinhaPermissaoEquipe() {
    try { return await requisitar('/equipe/minha'); } catch (e) { return null; }
  }

  async function solicitarPermissaoCriarBarbeiro() {
    try { await requisitar('/equipe/solicitar', { method: 'POST', body: '{}' }); return true; } catch (e) { return false; }
  }

  async function decidirSolicitacaoBarbeiro(id, decisao) {
    try {
      await requisitar(`/equipe/solicitacoes/${id}`, { method: 'PUT', body: JSON.stringify({ decisao }) });
      return true;
    } catch (e) { return false; }
  }

  async function definirPermissaoCriarBarbeiros(usuarioId, podeCriarBarbeiros) {
    try {
      await requisitar(`/equipe/${usuarioId}/permissao`, { method: 'PUT', body: JSON.stringify({ podeCriarBarbeiros }) });
      return true;
    } catch (e) { return false; }
  }

  async function rebaixarMaster(usuarioId) {
    try { await requisitar(`/equipe/${usuarioId}/rebaixar`, { method: 'PUT', body: '{}' }); return true; } catch (e) { return false; }
  }

  async function enviarUpload(tipo, nomeArquivo, mimeType, dataUrlOuBase64) {
    const base64 = dataUrlOuBase64.includes(',') ? dataUrlOuBase64.split(',')[1] : dataUrlOuBase64;
    // Se veio uma data URL, o tipo real da imagem está no prefixo (ex.: um
    // PNG enviado "no tamanho original" não pode ser declarado como JPEG).
    const prefixo = /^data:(image\/(?:jpeg|png|webp|gif));base64,/.exec(dataUrlOuBase64);
    if (prefixo) mimeType = prefixo[1];
    const resultado = await requisitar('/upload', {
      method: 'POST',
      body: JSON.stringify({ tipo, nomeArquivo, mimeType, conteudoBase64: base64 }),
    });
    return resultado.url;
  }

  /* ---------------------------------------------------------------------
     Exposição pública — mesmos nomes de sempre, agora todos assíncronos.
     --------------------------------------------------------------------- */
  window.db = {
    // offline
    getTamanhoFilaOffline,
    sincronizarFilaOffline: bpFilaProcessar,

    // sessão
    getSessao,
    usuarioLogado,
    cadastrarUsuario,
    criarBarbeiro,
    getEquipe,
    getPedidosPendentesEquipe,
    getMinhaPermissaoEquipe,
    solicitarPermissaoCriarBarbeiro,
    decidirSolicitacaoBarbeiro,
    definirPermissaoCriarBarbeiros,
    rebaixarMaster,
    getFaixaValores,
    salvarFaixaValores,
    getAjusteBanner,
    verificarEmail,
    esqueciSenha,
    redefinirSenha,
    login,
    logout: encerrarSessao,
    encerrarSessao,
    atualizarPerfil,
    excluirConta,

    // serviços
    getServicos,
    getServicoPorId,
    criarServico,
    atualizarServico,
    excluirServico,
    calcularTotal,
    calcularTotalAgendamento,
    nomesServicosAgendamento,
    getServicosDestaque,
    salvarServicosDestaque,

    // banner/config
    getConfig,
    salvarConfig,
    getBannerBarbearia,
    salvarBannerBarbearia,
    enviarIconeInfoLocalizacao,
    getEnderecoBarbearia,
    salvarEnderecoBarbearia,
    buscarCep,

    // barbeiros
    getBarbeiros,
    getBarbeiroPorId,

    // agendamentos
    getTodosAgendamentos,
    getAgendamentosDoUsuario,
    getProximoAgendamento,
    getHorariosDisponiveis,
    slotsNecessarios,
    salvarAgendamentoLocal,
    criarAgendamentoEquipe,
    remarcarAgendamentoLocal,
    getBloqueiosAgenda,
    criarBloqueioAgenda,
    removerBloqueioAgenda,
    atualizarStatusAgendamentoLocal,
    cancelarAgendamentoLocal,

    // preferências de corte
    getPreferenciasCorte,
    salvarPreferenciasCorte,

    // notificações
    getPreferenciaNotificacoes,
    salvarPreferenciaNotificacoes,
    getPreferenciaOfertas,
    salvarPreferenciaOfertas,
    getPreferenciaEmailAgendamentos,
    salvarPreferenciaEmailAgendamentos,
    getSomNotificacao,
    salvarSomNotificacao,
    getSomPersonalizado,
    salvarSomPersonalizado,
  };
})();
