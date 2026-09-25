/**
 * POST /api/upload
 * Body: { tipo: 'avatar' | 'banner' | 'som' | 'icone', nomeArquivo, mimeType, conteudoBase64 }
 *
 * Envia o arquivo para o ImageKit (CDN de imagens dedicado, com plano
 * gratuito próprio) em vez de guardar no Netlify Blobs. Isso importa por
 * dois motivos: (1) o Netlify cobra em créditos compartilhados entre
 * build, banda e functions — Blobs não tem URL pública própria, então
 * TODA visualização de uma imagem (não só o upload) passava por uma
 * function nossa e consumia esse crédito; (2) o ImageKit já serve as
 * imagens pela própria CDN dele, com redimensionamento sob demanda via
 * parâmetro de URL (usado em assets/src/ui.js pra pedir só o tamanho que
 * cada container precisa, em vez da imagem em resolução cheia sempre).
 *
 * Variáveis de ambiente necessárias (ver DEPLOY.md):
 *   IMAGEKIT_PRIVATE_KEY — chave privada da conta ImageKit (nunca expor no front-end)
 *
 * Limites (mesmos já aplicados no front-end hoje):
 *   avatar/banner/icone: até 2MB (ícone: 512KB), imagem
 *   som:                 até 1MB, áudio, até 6 segundos (duração validada
 *                        no navegador antes do upload — o servidor confia
 *                        no tamanho em bytes como segunda barreira)
 */
const crypto = require('crypto');
const { json, erro, metodoNaoPermitido, corpoJson, comProtecao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');
const { getSql } = require('./_lib/db');
const { validarImagem, validarAudio, ArquivoInvalido } = require('./_lib/imagem');
const { excedeuLimite, registrarUso } = require('./_lib/limite');

// Teto do corpo da requisição inteira (JSON + base64 do maior arquivo, 2 MB
// viram ~2,8 MB em base64). Recusar antes de decodificar evita gastar
// memória com um corpo enorme só para descobrir depois que passou do limite.
const LIMITE_CORPO_BYTES = 3 * 1024 * 1024;
// Máximo de envios por pessoa: cada arquivo ocupa espaço no ImageKit.
const MAX_UPLOADS_POR_HORA = 20;

const LIMITES_BYTES = {
  avatar: 2 * 1024 * 1024,
  banner: 2 * 1024 * 1024,
  som: 1 * 1024 * 1024,
  icone: 512 * 1024,
};

// Lista branca de tipos MIME aceitos por tipo de upload. Isso importa de
// verdade: o mimeType que o cliente manda aqui decide, lá no ImageKit,
// que tipo de arquivo será servido de volta — sem essa validação,
// qualquer pessoa logada (mesmo uma conta comum de cliente, já que o
// avatar não é restrito à equipe) poderia tentar mandar um tipo de
// arquivo perigoso disfarçado de imagem. Nunca inclua "image/svg+xml"
// aqui: SVG pode conter <script> e executa se a URL for aberta
// diretamente.
const MIME_PERMITIDOS = {
  avatar: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  banner: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  icone: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  som: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aiff', 'audio/x-aiff', 'audio/aac', 'audio/mp4', 'audio/ogg'],
};

const EXTENSAO_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
};

async function enviarParaImageKit(buffer, mimeType, nomeBase, pasta) {
  const chavePrivada = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!chavePrivada) {
    throw new Error('IMAGEKIT_PRIVATE_KEY não configurada. Veja DEPLOY.md na raiz do projeto.');
  }

  const extensao = EXTENSAO_POR_MIME[mimeType] || 'bin';
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), `${nomeBase}.${extensao}`);
  formData.append('fileName', `${nomeBase}.${extensao}`);
  formData.append('folder', `/barbear-prime/${pasta}`);
  formData.append('useUniqueFileName', 'false');

  const autenticacao = Buffer.from(`${chavePrivada}:`).toString('base64');
  const resposta = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: `Basic ${autenticacao}` },
    body: formData,
  });

  const resultado = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(resultado?.message || 'Falha ao enviar o arquivo para o ImageKit.');
  }
  return resultado.url;
}

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const usuario = await getUsuarioDaSessao(event);
  if (!usuario) return erro(401, 'Entre na sua conta para continuar.');

  if (event.body && Buffer.byteLength(event.body, 'utf8') > LIMITE_CORPO_BYTES) {
    return erro(413, 'Arquivo grande demais.');
  }
  const dados = corpoJson(event);
  if (!dados) return erro(400, 'JSON inválido.');

  const { tipo, nomeArquivo, mimeType } = dados;
  let { conteudoBase64 } = dados;
  if (typeof tipo !== 'string' || !Object.prototype.hasOwnProperty.call(LIMITES_BYTES, tipo)) {
    return erro(400, 'Tipo de upload inválido.');
  }
  if (typeof conteudoBase64 !== 'string' || !conteudoBase64) return erro(400, 'Envie o arquivo em conteudoBase64.');

  if (!MIME_PERMITIDOS[tipo].includes(mimeType)) {
    return erro(400, `Tipo de arquivo não aceito para ${tipo}. Use: ${MIME_PERMITIDOS[tipo].join(', ')}.`);
  }

  // banner e ícone (dos blocos de informação da Localização) só podem
  // ser trocados pelo barbeiro MASTER (mesma regra de servicos.js e
  // config.js — endereço/serviços/banner são configuração da barbearia
  // inteira, não de cada barbeiro).
  if ((tipo === 'banner' || tipo === 'icone') && (usuario.papel !== 'equipe' || !usuario.master)) {
    return erro(403, 'Apenas o barbeiro master pode alterar essa imagem.');
  }

  const sql = getSql();
  const chaveLimite = `upload:${usuario.id}`;
  if (await excedeuLimite(sql, chaveLimite, MAX_UPLOADS_POR_HORA, 60)) {
    return erro(429, 'Muitos envios em pouco tempo. Tente novamente em alguns minutos.');
  }

  // Aceita tanto base64 puro quanto uma "data URL" completa.
  conteudoBase64 = conteudoBase64.replace(/^data:[^;,]{1,60};base64,/, '');
  // Confere o TAMANHO antes de decodificar: 4 caracteres base64 = 3 bytes.
  if (Math.floor(conteudoBase64.length * 3 / 4) > LIMITES_BYTES[tipo] + 4) {
    const limiteMb = LIMITES_BYTES[tipo] / (1024 * 1024);
    return erro(413, `Arquivo maior que o limite de ${limiteMb}MB.`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(conteudoBase64)) {
    return erro(400, 'Conteúdo do arquivo inválido.');
  }
  let buffer = Buffer.from(conteudoBase64, 'base64');
  if (buffer.length > LIMITES_BYTES[tipo]) {
    const limiteMb = LIMITES_BYTES[tipo] / (1024 * 1024);
    return erro(413, `Arquivo maior que o limite de ${limiteMb}MB.`);
  }

  // Confere o CONTEÚDO de verdade (não a palavra do cliente): formato real,
  // dimensões (barra "bomba de descompressão": poucos KB que viram
  // gigabytes de pixels), bytes escondidos depois do fim do arquivo e
  // metadados privados (EXIF/GPS). Ver _lib/imagem.js.
  let mimeFinal = mimeType;
  try {
    if (tipo === 'som') {
      validarAudio(buffer);
    } else {
      const imagem = validarImagem(buffer);
      buffer = imagem.buffer;
      mimeFinal = imagem.mime; // o formato detectado manda, não o declarado
    }
  } catch (e) {
    if (e instanceof ArquivoInvalido) return erro(400, e.message);
    throw e;
  }

  await registrarUso(sql, chaveLimite);

  const nomeBase = `${tipo}-${usuario.id}-${crypto.randomUUID()}`;
  let urlPublica;
  try {
    urlPublica = await enviarParaImageKit(buffer, mimeFinal, nomeBase, tipo);
  } catch (e) {
    console.error('Falha no envio ao ImageKit:', e.message);
    return erro(502, 'Não foi possível enviar o arquivo agora. Tente novamente em instantes.');
  }

  if (tipo === 'avatar') {
    await sql`UPDATE usuarios SET avatar_url = ${urlPublica} WHERE id = ${usuario.id}`;
  } else if (tipo === 'banner') {
    await sql`
      INSERT INTO config_app (chave, valor) VALUES ('banner_barbearia_url', ${urlPublica})
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
    `;
  } else if (tipo === 'som') {
    // som_personalizado_nome é VARCHAR(190) no banco — sem cortar aqui,
    // um nome de arquivo grande demais (o navegador manda o nome original
    // do arquivo escolhido, que a pessoa não controla o tamanho) virava
    // um erro 500 cru do Postgres bem no fim do upload, depois do arquivo
    // já ter ido pro ImageKit.
    const nomeArquivoSeguro = nomeArquivo ? String(nomeArquivo).slice(0, 190) : null;
    await sql`
      INSERT INTO preferencias_notificacao (usuario_id, som_notificacao, som_personalizado_url, som_personalizado_nome)
      VALUES (${usuario.id}, 'personalizado', ${urlPublica}, ${nomeArquivoSeguro})
      ON CONFLICT (usuario_id) DO UPDATE SET
        som_notificacao = 'personalizado',
        som_personalizado_url = EXCLUDED.som_personalizado_url,
        som_personalizado_nome = EXCLUDED.som_personalizado_nome
    `;
  }

  return json(200, { url: urlPublica });
});
