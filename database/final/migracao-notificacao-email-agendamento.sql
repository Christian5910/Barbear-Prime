-- ============================================================================
-- MIGRAÇÃO: notificação por e-mail de novo agendamento (barbeiro)
-- ============================================================================
-- Rode isto se o seu banco já existia antes desta versão (um banco criado
-- do zero com schema-postgresql.sql atual já nasce com a coluna certa).
--
-- Desligado por padrão pra todo mundo (FALSE) — é opt-in, cada barbeiro
-- ativa pela própria tela de Preferências (sites/preferencias-app.html).
-- ============================================================================

ALTER TABLE preferencias_notificacao
  ADD COLUMN notif_email_agendamentos BOOLEAN NOT NULL DEFAULT FALSE;
