-- ============================================================================
-- MIGRAÇÃO: hierarquia de barbeiros (vários masters, permissões e pedidos)
-- ============================================================================
-- Seguro para rodar mais de uma vez. Um banco criado do zero com o
-- schema-postgresql.sql atual já nasce assim.
--
-- O que muda:
--   * Pode haver mais de um master. A conta master que já existia vira a
--     "master raiz": única, sem exclusão e sem rebaixamento.
--   * Barbeiros comuns podem receber permissão (dada por um master) para
--     criar outros barbeiros comuns, e podem pedir essa permissão.
--   * Tabela de limites de uso (contra abuso de cadastro e upload).
-- ============================================================================
BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS master_raiz BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pode_criar_barbeiros BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS criado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;

-- A master que existia até agora passa a ser a raiz.
UPDATE usuarios SET master_raiz = TRUE
WHERE master = TRUE
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE master_raiz = TRUE);

-- O índice antigo permitia só UM master; agora a unicidade é da raiz.
DROP INDEX IF EXISTS idx_usuarios_master_unico;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_master_raiz_unico ON usuarios (master_raiz) WHERE master_raiz = TRUE;

CREATE TABLE IF NOT EXISTS solicitacoes_criacao_barbeiro (
  id             BIGSERIAL PRIMARY KEY,
  solicitante_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status         VARCHAR(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'negada')),
  decidido_por   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_uma_pendente ON solicitacoes_criacao_barbeiro (solicitante_id) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS limites_uso (
  id        BIGSERIAL PRIMARY KEY,
  chave     VARCHAR(190) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_limites_uso_chave_data ON limites_uso (chave, criado_em);

COMMIT;
