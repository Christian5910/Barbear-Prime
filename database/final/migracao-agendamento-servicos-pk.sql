-- ============================================================================
-- MIGRAÇÃO: corrige a chave primária de agendamento_servicos
-- ============================================================================
-- Só rode este script se você JÁ tinha criado o banco com uma versão
-- anterior de schema-postgresql.sql (chave primária composta
-- (agendamento_id, nome_snapshot)). Bancos criados a partir da versão
-- atual de schema-postgresql.sql já nascem corretos — não precisa rodar
-- nada.
--
-- Por que isso importa: a chave antiga (agendamento_id, nome_snapshot)
-- supõe, sem garantir, que dois serviços nunca têm o mesmo nome. Se um
-- barbeiro cadastrasse por engano dois serviços com o nome idêntico e um
-- cliente marcasse os dois juntos no mesmo agendamento, o INSERT em
-- agendamento_servicos falhava (chave duplicada) e o agendamento não era
-- criado — um erro confuso de reproduzir e sem relação óbvia com a causa.
--
-- Como rodar:
--   psql "sua_connection_string" -f migracao-agendamento-servicos-pk.sql
-- ============================================================================

ALTER TABLE agendamento_servicos DROP CONSTRAINT agendamento_servicos_pkey;
ALTER TABLE agendamento_servicos ADD COLUMN id BIGSERIAL;
ALTER TABLE agendamento_servicos ADD PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS idx_agendamento_servicos_agendamento ON agendamento_servicos (agendamento_id);
