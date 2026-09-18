/**
 * Service Worker do Barbear Prime
 * ============================================================================
 * Responsabilidade ÚNICA deste arquivo: fazer as PÁGINAS (HTML/CSS/JS/
 * imagens) carregarem mesmo sem internet. Ele NÃO decide o que fazer com
 * dados da API (agendamentos, perfil etc.) — isso é responsabilidade de
 * database/db.js (cache em localStorage + fila de sincronização), porque
 * dados mudam de usuário para usuário e precisam de lógica própria de
 * "o que fazer quando voltar a conexão" que não faz sentido num service
 * worker genérico de arquivos.
 *
 * Estratégia:
 *  - Páginas (navegação): tenta a rede primeiro (pra sempre pegar a versão
 *    mais nova quando online); se falhar, cai pro cache; se nem isso
 *    existir, cai pra offline.html como último recurso.
 *  - Arquivos estáticos (css/js/imagens/ícones): cache primeiro (mais
 *    rápido, e raramente mudam sem um novo deploy do site inteiro).
 *  - Chamadas de API (/api/*): NUNCA interceptadas aqui — sempre vão
 *    direto pra rede. O cache e a fila de sincronização desses dados são
 *    tratados em database/db.js.
 *
 * Versionamento: mude CACHE_VERSAO sempre que a lista de arquivos abaixo
 * mudar (ex.: ao adicionar uma página nova) — isso força os navegadores
 * dos usuários a buscar a lista atualizada na próxima visita.
 */

const CACHE_VERSAO = 'barbear-prime-v1';

const ARQUIVOS_PRINCIPAIS = [
  './index.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/src/ui.js',
  './database/db.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/logo.png',
  './assets/img/logo-header.png',
  './assets/img/avatar-exemplo.jpg',
  './assets/img/capa-barbearia.jpg',
];

const PAGINAS_SITES = [
  'agendamento.html',
  'agendamentos.html',
  'cadastro.html',
  'editar-perfil.html',
  'localizacao.html',
  'login-equipe.html',
  'login.html',
  'meus-agendamentos.html',
  'offline.html',
  'painel-barbeiro.html',
  'perfil.html',
  'preferencias-app.html',
  'preferencias-corte.html',
  'servicos.html',
].map(nome => `./sites/${nome}`);

// CDNs externos (Bootstrap/Bootstrap Icons) — cacheados também, senão o
// visual do site quebra feio quando offline mesmo com o HTML disponível.
const ARQUIVOS_CDN = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css',
];

const TODOS_ARQUIVOS = [...ARQUIVOS_PRINCIPAIS, ...PAGINAS_SITES, ...ARQUIVOS_CDN];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSAO).then(async (cache) => {
      // addAll falha por inteiro se UM arquivo der erro (ex.: um CDN fora
      // do ar no momento do deploy) — adiciona um por um pra não deixar
      // o site inteiro sem cache por causa de um recurso externo.
      await Promise.all(
        TODOS_ARQUIVOS.map((url) => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_VERSAO).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nunca intercepta chamadas de API — sempre direto pra rede. Se a rede
  // falhar, o erro sobe normalmente pro código em database/db.js, que já
  // sabe lidar com isso (cache de leitura + fila de sincronização).
  if (url.pathname.startsWith('/api/')) return;

  // Só GET faz sentido cachear/servir do cache.
  if (request.method !== 'GET') return;

  const ehNavegacao = request.mode === 'navigate';

  if (ehNavegacao) {
    event.respondWith(
      fetch(request)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_VERSAO).then((cache) => cache.put(request, copia));
          return resposta;
        })
        .catch(async () => {
          const doCache = await caches.match(request);
          if (doCache) return doCache;
          // Só existe uma página de offline no projeto (sites/offline.html)
          // — serve ela como último recurso pra qualquer navegação que
          // falhar sem ter uma versão em cache.
          const offline = await caches.match('./sites/offline.html');
          return offline || Response.error();
        })
    );
    return;
  }

  // Arquivos estáticos: cache primeiro, com atualização em segundo plano.
  event.respondWith(
    caches.match(request).then((doCache) => {
      const buscarERenovar = fetch(request).then((resposta) => {
        if (resposta && resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_VERSAO).then((cache) => cache.put(request, copia));
        }
        return resposta;
      }).catch(() => doCache);
      return doCache || buscarERenovar;
    })
  );
});
