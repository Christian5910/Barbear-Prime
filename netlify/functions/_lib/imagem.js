/**
 * Validação e limpeza de arquivos enviados (imagem e áudio).
 * ============================================================================
 * Por que existe: o mimeType e o tamanho em bytes que o cliente declara não
 * dizem nada sobre o que o arquivo faz depois de aberto. Este módulo lê o
 * próprio conteúdo, sem depender de nenhuma biblioteca externa, e barra:
 *
 *  1. BOMBA DE DESCOMPRESSÃO (a "zip bomb" das imagens). Um PNG de 100 KB
 *     pode declarar 60000x60000 pixels: cabe no limite de bytes, mas quem
 *     abrir (o navegador de cada cliente, o ImageKit) tenta alocar gigabytes
 *     de memória. Lemos largura e altura direto do cabeçalho, ANTES de
 *     qualquer decodificação, e recusamos acima de MAX_LADO / MAX_PIXELS.
 *  2. ARQUIVO "POLÍGLOTA". Bytes extras colados depois do fim da imagem
 *     (um .zip, um script, uma segunda imagem gigante) passam por imagem
 *     válida. Cortamos tudo que vem depois do marcador de fim de cada formato.
 *  3. METADADOS PRIVADOS. Fotos de celular trazem EXIF com GPS, modelo do
 *     aparelho e data. Removemos EXIF/XMP/comentários dos JPEG e os blocos
 *     de texto dos PNG antes de publicar o arquivo.
 *  4. GIF com milhares de quadros (consome CPU e memória para animar): limite
 *     de MAX_QUADROS_GIF.
 *  5. Estruturas quebradas ou malformadas: qualquer inconsistência (tamanho
 *     de bloco maior que o arquivo, marcador desconhecido, fim ausente) vira
 *     erro, nunca um "vamos tentar mesmo assim".
 *
 * NÃO faz reencodificação de pixels (isso exigiria uma biblioteca nativa como
 * o sharp). Quem envia o arquivo pelo site já passa por um recorte no
 * navegador, que gera pixels novos; este módulo protege a API contra quem
 * chama /api/upload direto, sem passar pela tela.
 */

const MAX_LADO = 6000;             // pixels em cada dimensão
const MAX_PIXELS = 24 * 1000 * 1000; // 24 megapixels no total
const MAX_QUADROS_GIF = 120;

class ArquivoInvalido extends Error {}

function falhar(mensagem) {
  throw new ArquivoInvalido(mensagem);
}

function conferirDimensoes(largura, altura) {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1) {
    falhar('A imagem tem dimensões inválidas.');
  }
  if (largura > MAX_LADO || altura > MAX_LADO || largura * altura > MAX_PIXELS) {
    falhar(`A imagem é grande demais (${largura}x${altura}). Use no máximo ${MAX_LADO} pixels de lado e ${MAX_PIXELS / 1000000} megapixels no total.`);
  }
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function iguais(buffer, offset, bytes) {
  if (offset + bytes.length > buffer.length) return false;
  return bytes.every((v, k) => buffer[offset + k] === v);
}

/* ------------------------------------------------------------------ PNG */
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Blocos que só carregam texto/metadados e não afetam a imagem.
const PNG_BLOCOS_DESCARTAVEIS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function analisarPng(buffer) {
  let pos = 8;
  let largura = 0;
  let altura = 0;
  let viuIhdr = false;
  let viuIdat = false;
  const partes = [buffer.subarray(0, 8)];

  while (pos + 12 <= buffer.length) {
    const tamanho = u32be(buffer, pos);
    const tipo = buffer.toString('latin1', pos + 4, pos + 8);
    const fim = pos + 12 + tamanho;
    if (tamanho > 0x7fffffff || fim > buffer.length) falhar('Arquivo PNG corrompido.');

    if (!viuIhdr) {
      if (tipo !== 'IHDR' || tamanho !== 13) falhar('Arquivo PNG corrompido.');
      largura = u32be(buffer, pos + 8);
      altura = u32be(buffer, pos + 12);
      conferirDimensoes(largura, altura); // antes de olhar qualquer outra coisa
      viuIhdr = true;
    }
    if (tipo === 'IDAT') viuIdat = true;

    if (!PNG_BLOCOS_DESCARTAVEIS.has(tipo)) partes.push(buffer.subarray(pos, fim));
    pos = fim;

    if (tipo === 'IEND') {
      if (!viuIdat) falhar('Arquivo PNG corrompido.');
      // Tudo depois do IEND é descartado (dados escondidos).
      return { mime: 'image/png', largura, altura, buffer: Buffer.concat(partes) };
    }
  }
  return falhar('Arquivo PNG corrompido ou incompleto.');
}


/**
 * Lê só a orientação (tag 0x0112) de um bloco EXIF. Sem ela, fotos de
 * celular tiradas "em pé" apareceriam deitadas depois de removermos o EXIF.
 * Devolve 2..8 (1 = já correta, nada a preservar) ou null.
 */
function lerOrientacaoExif(segmento) {
  // segmento: FF E1 LL LL 'Exif\0\0' TIFF...
  if (segmento.length < 22 || segmento.toString('latin1', 4, 8) !== 'Exif') return null;
  const t = 10; // início do cabeçalho TIFF
  const le = segmento.toString('latin1', t, t + 2) === 'II';
  if (!le && segmento.toString('latin1', t, t + 2) !== 'MM') return null;
  const l16 = (i) => (le ? segmento[i] | (segmento[i + 1] << 8) : (segmento[i] << 8) | segmento[i + 1]);
  const l32 = (i) => (le
    ? (segmento[i] | (segmento[i + 1] << 8) | (segmento[i + 2] << 16) | (segmento[i + 3] << 24)) >>> 0
    : ((segmento[i] << 24) | (segmento[i + 1] << 16) | (segmento[i + 2] << 8) | segmento[i + 3]) >>> 0);
  if (l16(t + 2) !== 42) return null;
  const ifd = t + l32(t + 4);
  if (ifd + 2 > segmento.length) return null;
  const qtd = Math.min(l16(ifd), 64);
  for (let k = 0; k < qtd; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > segmento.length) return null;
    if (l16(e) === 0x0112) {
      const v = l16(e + 8);
      return v >= 2 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** EXIF mínimo (32 bytes) contendo só a orientação. */
function exifSoOrientacao(orientacao) {
  return Buffer.from([
    0xff, 0xe1, 0x00, 0x22,                   // APP1, tamanho 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,       // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD0 no offset 8
    0x00, 0x01,                               // 1 entrada
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacao, 0x00, 0x00, // orientação
    0x00, 0x00, 0x00, 0x00,                   // sem próximo IFD
  ]);
}

/* ----------------------------------------------------------------- JPEG */
// Marcadores SOF (início de quadro), que trazem altura e largura.
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// APP1 (EXIF/XMP), APP13 (Photoshop/IPTC) e comentário: privados e dispensáveis.
const JPEG_DESCARTAVEIS = new Set([0xe1, 0xed, 0xfe]);

function analisarJpeg(buffer) {
  let pos = 2;
  let largura = 0;
  let altura = 0;
  const partes = [buffer.subarray(0, 2)];
  let terminou = false;
  let viuSof = false;
  let viuSos = false;
  let orientacao = null;

  while (pos < buffer.length) {
    if (buffer[pos] !== 0xff) falhar('Arquivo JPEG corrompido.');
    while (buffer[pos] === 0xff) pos++; // preenchimento
    const marcador = buffer[pos];
    pos++;
    if (marcador === undefined) break;

    if (marcador === 0xd9) { // EOI
      partes.push(Buffer.from([0xff, 0xd9]));
      terminou = true;
      break;
    }
    if (marcador === 0x00 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) {
      falhar('Arquivo JPEG corrompido.');
    }

    if (pos + 2 > buffer.length) falhar('Arquivo JPEG corrompido.');
    const tamanho = u16be(buffer, pos);
    if (tamanho < 2 || pos + tamanho > buffer.length) falhar('Arquivo JPEG corrompido.');

    if (JPEG_SOF.has(marcador)) {
      if (tamanho < 8) falhar('Arquivo JPEG corrompido.');
      altura = u16be(buffer, pos + 3);
      largura = u16be(buffer, pos + 5);
      conferirDimensoes(largura, altura);
      viuSof = true;
    }

    const segmento = buffer.subarray(pos - 2, pos + tamanho);
    if (marcador === 0xe1 && orientacao === null) {
      const o = lerOrientacaoExif(segmento);
      if (o) orientacao = o;
    }
    if (!JPEG_DESCARTAVEIS.has(marcador)) partes.push(segmento);
    pos += tamanho;

    if (marcador === 0xda) { // SOS: dados comprimidos até o próximo marcador de verdade
      viuSos = true;
      const inicioDados = pos;
      while (pos < buffer.length) {
        if (buffer[pos] === 0xff) {
          const prox = buffer[pos + 1];
          if (prox === 0x00 || (prox >= 0xd0 && prox <= 0xd7)) { pos += 2; continue; }
          if (prox === 0xff) { pos += 1; continue; }
          break;
        }
        pos++;
      }
      partes.push(buffer.subarray(inicioDados, pos));
    }
  }

  if (!terminou || !viuSof || !viuSos) falhar('Arquivo JPEG corrompido ou incompleto.');
  // Reinsere só a orientação logo depois do SOI (o EXIF original foi removido).
  if (orientacao) partes.splice(1, 0, exifSoOrientacao(orientacao));
  return { mime: 'image/jpeg', largura, altura, buffer: Buffer.concat(partes) };
}

/* ------------------------------------------------------------------ GIF */
function pularSubBlocos(buffer, pos) {
  for (;;) {
    if (pos >= buffer.length) falhar('Arquivo GIF corrompido.');
    const tam = buffer[pos];
    pos += 1;
    if (tam === 0) return pos;
    pos += tam;
    if (pos > buffer.length) falhar('Arquivo GIF corrompido.');
  }
}

function analisarGif(buffer) {
  if (buffer.length < 13) falhar('Arquivo GIF corrompido.');
  const largura = u16le(buffer, 6);
  const altura = u16le(buffer, 8);
  conferirDimensoes(largura, altura);

  const flags = buffer[10];
  let pos = 13;
  if (flags & 0x80) pos += 3 * (1 << ((flags & 0x07) + 1));
  let quadros = 0;

  while (pos < buffer.length) {
    const bloco = buffer[pos];
    if (bloco === 0x3b) { // trailer: fim do GIF
      if (quadros < 1) falhar('Arquivo GIF sem imagem.');
      return { mime: 'image/gif', largura, altura, quadros, buffer: buffer.subarray(0, pos + 1) };
    }
    if (bloco === 0x21) { // extensão (legenda, animação, comentário)
      pos = pularSubBlocos(buffer, pos + 2);
    } else if (bloco === 0x2c) { // quadro de imagem
      quadros++;
      if (quadros > MAX_QUADROS_GIF) falhar(`GIF com quadros demais (máximo ${MAX_QUADROS_GIF}).`);
      if (pos + 10 > buffer.length) falhar('Arquivo GIF corrompido.');
      const f = buffer[pos + 9];
      pos += 10;
      if (f & 0x80) pos += 3 * (1 << ((f & 0x07) + 1));
      pos += 1; // tamanho mínimo do código LZW
      pos = pularSubBlocos(buffer, pos);
    } else {
      falhar('Arquivo GIF corrompido.');
    }
  }
  return falhar('Arquivo GIF incompleto.');
}

/* ----------------------------------------------------------------- WEBP */
function analisarWebp(buffer) {
  if (buffer.length < 30) falhar('Arquivo WEBP corrompido.');
  const total = u32le(buffer, 4) + 8;
  if (total > buffer.length || total < 20) falhar('Arquivo WEBP corrompido.');
  const dados = buffer.subarray(0, total); // corta o que vem depois do fim declarado

  const tipo = dados.toString('latin1', 12, 16);
  let largura;
  let altura;
  if (tipo === 'VP8 ') {
    if (!iguais(dados, 23, [0x9d, 0x01, 0x2a])) falhar('Arquivo WEBP corrompido.');
    largura = u16le(dados, 26) & 0x3fff;
    altura = u16le(dados, 28) & 0x3fff;
  } else if (tipo === 'VP8L') {
    if (dados[20] !== 0x2f) falhar('Arquivo WEBP corrompido.');
    const bits = u32le(dados, 21);
    largura = (bits & 0x3fff) + 1;
    altura = ((bits >>> 14) & 0x3fff) + 1;
  } else if (tipo === 'VP8X') {
    largura = u24le(dados, 24) + 1;
    altura = u24le(dados, 27) + 1;
  } else {
    return falhar('Arquivo WEBP corrompido.');
  }
  conferirDimensoes(largura, altura);
  return { mime: 'image/webp', largura, altura, buffer: dados };
}

function u32le(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

/**
 * Confere e limpa uma imagem. Devolve { mime, largura, altura, buffer } com o
 * buffer já sem dados extras/metadados, ou lança ArquivoInvalido.
 * O tipo é decidido pelo CONTEÚDO, nunca pelo mimeType declarado.
 */
function validarImagem(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) falhar('O arquivo enviado não parece ser uma imagem válida.');
  if (iguais(buffer, 0, ASSINATURA_PNG)) return analisarPng(buffer);
  if (iguais(buffer, 0, [0xff, 0xd8, 0xff])) return analisarJpeg(buffer);
  if (iguais(buffer, 0, [0x47, 0x49, 0x46, 0x38]) && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) {
    return analisarGif(buffer);
  }
  if (iguais(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && iguais(buffer, 8, [0x57, 0x45, 0x42, 0x50])) {
    return analisarWebp(buffer);
  }
  return falhar('O arquivo enviado não parece ser uma imagem válida.');
}

/**
 * Áudio: confere que os primeiros bytes batem com um formato de áudio de
 * verdade (não dá para ler a duração sem decodificar; o tamanho em bytes é
 * limitado por quem chama).
 */
function validarAudio(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) falhar('O arquivo enviado não parece ser um áudio válido.');
  const ok =
    iguais(buffer, 0, [0x49, 0x44, 0x33]) ||                                   // MP3 com ID3
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ||                    // MP3/AAC (sync)
    (iguais(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && iguais(buffer, 8, [0x57, 0x41, 0x56, 0x45])) || // WAV
    (iguais(buffer, 0, [0x46, 0x4f, 0x52, 0x4d]) && (iguais(buffer, 8, [0x41, 0x49, 0x46, 0x46]) || iguais(buffer, 8, [0x41, 0x49, 0x46, 0x43]))) || // AIFF
    iguais(buffer, 4, [0x66, 0x74, 0x79, 0x70]) ||                            // M4A/MP4
    iguais(buffer, 0, [0x4f, 0x67, 0x67, 0x53]);                              // OGG
  if (!ok) falhar('O arquivo enviado não parece ser um áudio válido.');
  return { buffer };
}

module.exports = { validarImagem, validarAudio, ArquivoInvalido, MAX_LADO, MAX_PIXELS, MAX_QUADROS_GIF };
