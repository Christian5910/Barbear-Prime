/**
 * Validação de URLs de imagem gravadas no banco (avatar, banner, ícones).
 * ============================================================================
 * Só aceitamos imagens que o PRÓPRIO site hospeda: as do ImageKit (para onde
 * /api/upload envia tudo) ou arquivos da pasta /assets/ do site. Antes era
 * qualquer URL http(s), o que deixava alguém apontar o avatar para um
 * servidor seu: quem visse o avatar (a equipe, ao abrir a agenda) passava a
 * ter o IP e o navegador registrados nesse servidor, e o conteúdo da imagem
 * podia ser trocado depois sem ninguém perceber.
 *
 * Domínio extra opcional: IMAGEKIT_URL_ENDPOINT (ex.:
 * "https://ik.imagekit.io/seu_id" ou um domínio próprio do ImageKit).
 */
function hostsPermitidos() {
  const hosts = new Set(['ik.imagekit.io']);
  try {
    if (process.env.IMAGEKIT_URL_ENDPOINT) hosts.add(new URL(process.env.IMAGEKIT_URL_ENDPOINT).host);
  } catch (e) { /* endpoint mal formado: ignora */ }
  return hosts;
}

/**
 * Devolve a URL normalizada, null (vazio) ou lança Error com mensagem em
 * português (o chamador transforma em 400).
 */
function normalizarUrlImagem(valor, rotulo = 'imagem') {
  if (valor === undefined || valor === null || valor === '') return null;
  const texto = String(valor);
  if (texto.length > 500) throw new Error(`URL de ${rotulo} muito longa.`);

  // Arquivo do próprio site (ex.: avatar de exemplo)
  if (texto.startsWith('/assets/')) {
    if (texto.includes('..') || texto.includes('//') || /[\s"'<>\\]/.test(texto)) {
      throw new Error(`URL de ${rotulo} inválida.`);
    }
    return texto;
  }

  let url;
  try {
    url = new URL(texto);
  } catch (e) {
    throw new Error(`URL de ${rotulo} inválida.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || !hostsPermitidos().has(url.host)) {
    throw new Error(`A ${rotulo} precisa ter sido enviada pelo próprio site.`);
  }
  return url.href;
}

module.exports = { normalizarUrlImagem };
