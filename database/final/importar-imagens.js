#!/usr/bin/env node
/**
 * BARBEAR PRIME — Gera o SQL de importação das imagens para a tabela `midia`.
 * ============================================================================
 * Uso (dentro da pasta database/final):
 *
 *   node importar-imagens.js > midia-insert.sql
 *   mysql -u seu_usuario -p barbear_prime < schema-midia-mysql.sql
 *   mysql -u seu_usuario -p barbear_prime < midia-insert.sql
 *
 * O que este script faz:
 *   1. Lê todo arquivo de imagem em ./images/
 *   2. Gera um INSERT INTO midia (...) VALUES (...) por arquivo, com o
 *      conteúdo em hexadecimal (formato aceito nativamente pelo MySQL para
 *      colunas BLOB — via UNHEX(), sem precisar de driver especial).
 *
 * Isso só é necessário se você optar por guardar as imagens dentro do banco
 * (ver aviso em schema-midia-mysql.sql). Se for usar um storage de arquivos
 * (recomendado — ver README.md), você não precisa deste script: basta subir
 * os arquivos de ./images/ para o storage escolhido e usar a URL resultante
 * nas colunas *_url do schema principal.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const PASTA_IMAGENS = path.join(__dirname, 'images');

const MIME_POR_EXTENSAO = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function chaveDoArquivo(nomeArquivo) {
  return path.basename(nomeArquivo, path.extname(nomeArquivo));
}

function main() {
  if (!fs.existsSync(PASTA_IMAGENS)) {
    console.error(`Pasta não encontrada: ${PASTA_IMAGENS}`);
    process.exit(1);
  }

  const arquivos = fs.readdirSync(PASTA_IMAGENS)
    .filter(nome => MIME_POR_EXTENSAO[path.extname(nome).toLowerCase()]);

  if (!arquivos.length) {
    console.error('Nenhuma imagem encontrada em ./images/.');
    process.exit(1);
  }

  console.log('-- Gerado por importar-imagens.js — não editar manualmente.');
  console.log('USE barbear_prime;');
  console.log('');

  arquivos.forEach(nomeArquivo => {
    const caminhoCompleto = path.join(PASTA_IMAGENS, nomeArquivo);
    const bytes = fs.readFileSync(caminhoCompleto);
    const extensao = path.extname(nomeArquivo).toLowerCase();
    const mime = MIME_POR_EXTENSAO[extensao];
    const chave = chaveDoArquivo(nomeArquivo);
    const hex = bytes.toString('hex');

    console.log(
      `INSERT INTO midia (chave, nome_arquivo, mime_type, tamanho_bytes, conteudo) VALUES ` +
      `('${chave}', '${nomeArquivo}', '${mime}', ${bytes.length}, UNHEX('${hex}')) ` +
      `ON DUPLICATE KEY UPDATE conteudo = VALUES(conteudo), tamanho_bytes = VALUES(tamanho_bytes);`
    );
  });

  console.error(`OK: ${arquivos.length} imagem(ns) processada(s).`);
}

main();
