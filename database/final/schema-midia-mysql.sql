-- ============================================================================
-- BARBEAR PRIME — Tabela opcional de mídia (MySQL 8+)
-- ============================================================================
-- Uso opcional: só é necessário se você quiser guardar as imagens do site
-- DENTRO do próprio banco (LONGBLOB), em vez de num storage de arquivos.
--
-- Recomendação (ver README.md): normalmente é melhor subir as imagens para
-- um storage de arquivos (Netlify não serve para isso sozinho, veja as
-- opções no README) e guardar só a URL nas colunas avatar_url,
-- banner_barbearia_url etc. já previstas em schema-mysql.sql.
--
-- Esta tabela existe para o cenário "quero tudo no mesmo banco SQL, sem
-- montar um storage separado" — funciona, mas cresce o banco rápido e é
-- mais lento para servir do que um storage/CDN dedicado.
-- ============================================================================

USE barbear_prime;

CREATE TABLE midia (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chave          VARCHAR(80) NOT NULL,   -- ex.: 'logo', 'capa-barbearia', 'avatar-exemplo'
  nome_arquivo   VARCHAR(190) NOT NULL,  -- ex.: 'capa-barbearia.jpg'
  mime_type      VARCHAR(100) NOT NULL,  -- ex.: 'image/jpeg'
  tamanho_bytes  INT UNSIGNED NOT NULL,
  conteudo       LONGBLOB NOT NULL,      -- bytes crus do arquivo
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_midia_chave (chave)
) ENGINE=InnoDB;
