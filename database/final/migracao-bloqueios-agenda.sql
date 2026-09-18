-- ============================================================================
-- MIGRAÇÃO: adiciona a tabela bloqueios_agenda (dia de folga / horário bloqueado)
-- ============================================================================
-- Só rode este script se você JÁ tinha criado o banco antes desta função
-- existir. Bancos criados a partir da versão atual de
-- schema-postgresql.sql já nascem com essa tabela — não precisa rodar nada.
--
-- Como rodar:
--   psql "sua_connection_string" -f migracao-bloqueios-agenda.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS bloqueios_agenda (
  id             BIGSERIAL PRIMARY KEY,
  barbeiro_id    BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  hora           TIME NULL,
  motivo         VARCHAR(120) NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_barbeiro_data ON bloqueios_agenda (barbeiro_id, data);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bloqueios_horario_unico ON bloqueios_agenda (barbeiro_id, data, hora) WHERE hora IS NOT NULL;
