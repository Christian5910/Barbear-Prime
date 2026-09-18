-- ============================================================================
-- MIGRAÇÃO: verificação de e-mail no cadastro + recuperação de senha
-- ============================================================================
-- Só rode este script se você JÁ tinha criado o banco antes desta versão.
-- Bancos criados a partir da versão atual de schema-postgresql.sql já
-- nascem com a coluna e as tabelas abaixo — não precisa rodar nada.
--
-- Como rodar:
--   psql "sua_connection_string" -f migracao-verificacao-email-recuperacao-senha.sql
--
-- IMPORTANTE: depois de rodar, contas que já existiam ficam com
-- email_verificado = FALSE (valor padrão da coluna nova). Isso NÃO afeta
-- o login de ninguém — email_verificado é só informativo, nunca uma
-- trava de acesso (ver netlify/functions/auth-login.js). Não precisa
-- rodar nenhum UPDATE depois: contas antigas continuam entrando
-- normalmente com a senha de sempre.
-- ============================================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS verificacoes_email (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL UNIQUE,
  expira_em      TIMESTAMPTZ NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verificacoes_email_usuario ON verificacoes_email (usuario_id);

CREATE TABLE IF NOT EXISTS recuperacoes_senha (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL UNIQUE,
  expira_em      TIMESTAMPTZ NOT NULL,
  usado_em       TIMESTAMPTZ NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recuperacoes_senha_usuario ON recuperacoes_senha (usuario_id);
