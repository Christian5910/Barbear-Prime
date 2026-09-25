-- ============================================================================
-- BARBEAR PRIME — Schema de produção (PostgreSQL 14+)
-- ============================================================================
-- Mesma estrutura de schema-mysql.sql, adaptada para PostgreSQL — útil se
-- for hospedar em Supabase, Neon, Railway ou outro Postgres gerenciado
-- (combinações comuns com um front-end estático no Netlify).
--
-- Como importar:
--   psql "sua_connection_string" -f schema-postgresql.sql
--   psql "sua_connection_string" -f seed-postgresql.sql
-- ============================================================================

CREATE TYPE papel_usuario AS ENUM ('cliente', 'equipe');
CREATE TYPE status_agendamento AS ENUM ('pendente', 'confirmado', 'cancelado');
CREATE TYPE som_notificacao_tipo AS ENUM ('padrao', 'sino', 'navalha', 'personalizado', 'silencioso');

-- ----------------------------------------------------------------------------
-- USUÁRIOS (clientes e equipe/barbeiros — mesma tabela, campo `papel` distingue)
-- ----------------------------------------------------------------------------
CREATE TABLE usuarios (
  id                BIGSERIAL PRIMARY KEY,
  nome              VARCHAR(120) NOT NULL,
  email             VARCHAR(190) NOT NULL UNIQUE,
  senha_hash        VARCHAR(255) NOT NULL,
  papel             papel_usuario NOT NULL DEFAULT 'cliente',
  avatar_url        TEXT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  -- FALSE até o link do e-mail de confirmação ser clicado (ver
  -- verificacoes_email abaixo). NÃO bloqueia login — é informativo, do
  -- mesmo jeito que "esqueci minha senha" é um recurso disponível sem
  -- ser obrigatório (ver netlify/functions/auth-login.js).
  email_verificado  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Só tem efeito quando papel = 'equipe'. O barbeiro "master" é o único
  -- que pode: convidar novos barbeiros, editar endereço/informações da
  -- Localização, editar o banner do painel, e gerenciar o catálogo de
  -- serviços. Um barbeiro comum (master = FALSE) só mexe na própria
  -- agenda (ver netlify/functions/servicos.js, config.js, upload.js,
  -- auth-cadastro.js). A conta master nunca pode ser excluída (ver
  -- usuarios.js) — existe sempre pelo menos uma, pra nunca ninguém ficar
  -- travado sem conseguir gerenciar a barbearia.
  master            BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Hierarquia da equipe (ver migracao-hierarquia-barbeiros.sql):
--   master_raiz          a conta original da barbearia. Só existe UMA, nunca
--                        pode ser excluída nem rebaixada.
--   master               pode haver vários masters (a raiz + os que ela ou
--                        outro master criou conscientemente).
--   pode_criar_barbeiros permissão dada por um master a um barbeiro comum
--                        para criar outros barbeiros COMUNS (nunca master).
--   criado_por           quem criou a conta (auditoria).
ALTER TABLE usuarios ADD COLUMN master_raiz BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN pode_criar_barbeiros BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN criado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_usuarios_master_raiz_unico ON usuarios (master_raiz) WHERE master_raiz = TRUE;
CREATE INDEX idx_usuarios_papel ON usuarios (papel);

-- ----------------------------------------------------------------------------
-- SESSÕES
-- ----------------------------------------------------------------------------
CREATE TABLE sessoes (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL UNIQUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessoes_usuario ON sessoes (usuario_id);

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO DE E-MAIL (token de uso único, enviado no cadastro)
-- ----------------------------------------------------------------------------
-- Mesmo padrão de `sessoes`: o token em si (grande, aleatório) só existe no
-- e-mail que a pessoa recebe; aqui só fica o HASH dele. Um token vazado do
-- banco (backup, dump, etc.) não é suficiente pra confirmar um e-mail —
-- só o hash de um token que ninguém mais tem.
CREATE TABLE verificacoes_email (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL UNIQUE,
  expira_em      TIMESTAMPTZ NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_verificacoes_email_usuario ON verificacoes_email (usuario_id);

-- ----------------------------------------------------------------------------
-- RECUPERAÇÃO DE SENHA ("esqueci minha senha", token de uso único)
-- ----------------------------------------------------------------------------
CREATE TABLE recuperacoes_senha (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL UNIQUE,
  expira_em      TIMESTAMPTZ NOT NULL,
  -- NULL = ainda não usado. Marcar em vez de apagar a linha na hora de usar
  -- deixa rastro (quando a senha foi trocada) e também é o que barra um
  -- mesmo token de ser reaproveitado duas vezes.
  usado_em       TIMESTAMPTZ NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recuperacoes_senha_usuario ON recuperacoes_senha (usuario_id);

-- ----------------------------------------------------------------------------
-- SERVIÇOS (catálogo editável pela equipe)
-- ----------------------------------------------------------------------------
CREATE TABLE servicos (
  id             BIGSERIAL PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  descricao      TEXT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  duracao_min    INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min > 0),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  destaque       BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_servicos_destaque ON servicos (destaque);
CREATE INDEX idx_servicos_nome ON servicos (nome);

-- ----------------------------------------------------------------------------
-- AGENDAMENTOS
-- ----------------------------------------------------------------------------
CREATE TABLE agendamentos (
  id                  BIGSERIAL PRIMARY KEY,
  usuario_id          BIGINT NULL REFERENCES usuarios (id) ON DELETE SET NULL,
  cliente_nome        VARCHAR(120) NOT NULL,
  barbeiro_id         BIGINT NULL REFERENCES usuarios (id) ON DELETE SET NULL,
  data_servico        DATE NOT NULL,
  hora_inicio         TIME NOT NULL,
  status              status_agendamento NOT NULL DEFAULT 'pendente',
  criado_pela_equipe  BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agendamentos_usuario ON agendamentos (usuario_id);
CREATE INDEX idx_agendamentos_barbeiro ON agendamentos (barbeiro_id);
CREATE INDEX idx_agendamentos_data_hora ON agendamentos (data_servico, hora_inicio);

-- ----------------------------------------------------------------------------
-- HORÁRIOS OCUPADOS POR AGENDAMENTO (suporte a serviços de 2+ slots)
-- ----------------------------------------------------------------------------
CREATE TABLE agendamento_horarios (
  agendamento_id BIGINT NOT NULL REFERENCES agendamentos (id) ON DELETE CASCADE,
  hora           TIME NOT NULL,
  PRIMARY KEY (agendamento_id, hora)
);

-- ----------------------------------------------------------------------------
-- SERVIÇOS DE CADA AGENDAMENTO (com snapshot de preço/nome)
-- ----------------------------------------------------------------------------
-- Chave primária é um id próprio (não a combinação agendamento_id +
-- nome_snapshot) de propósito: se dois serviços do catálogo tiverem o
-- mesmo nome (nada impede isso hoje), um cliente que marcasse os dois
-- juntos no mesmo agendamento faria essa linha colidir e o INSERT falharia.
CREATE TABLE agendamento_servicos (
  id                      BIGSERIAL PRIMARY KEY,
  agendamento_id          BIGINT NOT NULL REFERENCES agendamentos (id) ON DELETE CASCADE,
  servico_id              BIGINT NULL REFERENCES servicos (id) ON DELETE SET NULL,
  nome_snapshot           VARCHAR(120) NOT NULL,
  preco_centavos_snapshot INTEGER NOT NULL
);
CREATE INDEX idx_agendamento_servicos_agendamento ON agendamento_servicos (agendamento_id);

-- ----------------------------------------------------------------------------
-- PREFERÊNCIAS DE CORTE (uma linha por cliente)
-- ----------------------------------------------------------------------------
CREATE TABLE preferencias_corte (
  usuario_id      BIGINT PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  tamanho_cabelo  VARCHAR(40) NULL,
  tipo_degrade    VARCHAR(40) NULL,
  acabamento      VARCHAR(40) NULL,
  estilo_barba    VARCHAR(40) NULL,
  notas           TEXT NULL,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- CONFIGURAÇÃO GERAL DO APP (chave-valor solta, ex.: banner da barbearia)
-- ----------------------------------------------------------------------------
CREATE TABLE config_app (
  chave          VARCHAR(60) PRIMARY KEY,
  valor          TEXT NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- PREFERÊNCIAS DE NOTIFICAÇÃO (uma linha por cliente)
-- ----------------------------------------------------------------------------
CREATE TABLE preferencias_notificacao (
  usuario_id             BIGINT PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  notif_agendamentos     BOOLEAN NOT NULL DEFAULT TRUE,
  notif_ofertas          BOOLEAN NOT NULL DEFAULT FALSE,
  -- Só tem efeito para contas de equipe: manda um e-mail (via Resend, ver
  -- _lib/email.js) para o próprio barbeiro sempre que um cliente cria um
  -- agendamento atribuído a ele. Desligado por padrão — é opt-in, ver
  -- sites/preferencias-app.html.
  notif_email_agendamentos BOOLEAN NOT NULL DEFAULT FALSE,
  som_notificacao        som_notificacao_tipo NOT NULL DEFAULT 'padrao',
  som_personalizado_url  TEXT NULL,
  som_personalizado_nome VARCHAR(190) NULL,
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TENTATIVAS DE LOGIN (auditoria/rate limit básico)
-- ----------------------------------------------------------------------------
CREATE TABLE tentativas_login (
  id             BIGSERIAL PRIMARY KEY,
  email          VARCHAR(190) NOT NULL,
  sucesso        BOOLEAN NOT NULL,
  ip             VARCHAR(45) NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tentativas_email_data ON tentativas_login (email, criado_em);

-- ----------------------------------------------------------------------------
-- BLOQUEIOS DE AGENDA (dia de folga ou horário específico bloqueado)
-- ----------------------------------------------------------------------------
-- hora NULL = o dia inteiro está bloqueado para esse barbeiro;
-- hora preenchida = só aquele horário específico está bloqueado.
-- A unicidade de "dia inteiro" (hora NULL) é garantida em código (não dá
-- pra usar UNIQUE numa coluna NULL-ável no Postgres — NULLs nunca colidem
-- entre si), então o endpoint sempre confere antes de inserir.
CREATE TABLE bloqueios_agenda (
  id             BIGSERIAL PRIMARY KEY,
  barbeiro_id    BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  hora           TIME NULL,
  motivo         VARCHAR(120) NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bloqueios_barbeiro_data ON bloqueios_agenda (barbeiro_id, data);
CREATE UNIQUE INDEX idx_bloqueios_horario_unico ON bloqueios_agenda (barbeiro_id, data, hora) WHERE hora IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Gatilhos para manter atualizado_em em UPDATE (Postgres não tem
-- "ON UPDATE CURRENT_TIMESTAMP" nativo como o MySQL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_atualizado BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_servicos_atualizado BEFORE UPDATE ON servicos
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_agendamentos_atualizado BEFORE UPDATE ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_preferencias_corte_atualizado BEFORE UPDATE ON preferencias_corte
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_config_app_atualizado BEFORE UPDATE ON config_app
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_preferencias_notif_atualizado BEFORE UPDATE ON preferencias_notificacao
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

-- ----------------------------------------------------------------------------
-- Pedidos de barbeiros comuns para poderem criar outros barbeiros comuns.
-- Um master aprova ou nega na aba Perfil.
-- ----------------------------------------------------------------------------
CREATE TABLE solicitacoes_criacao_barbeiro (
  id             BIGSERIAL PRIMARY KEY,
  solicitante_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status         VARCHAR(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'negada')),
  decidido_por   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em    TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_solicitacoes_uma_pendente ON solicitacoes_criacao_barbeiro (solicitante_id) WHERE status = 'pendente';

-- ----------------------------------------------------------------------------
-- Contador genérico para limitar abusos (cadastros em massa, uploads, etc.).
-- Ver netlify/functions/_lib/limite.js.
-- ----------------------------------------------------------------------------
CREATE TABLE limites_uso (
  id        BIGSERIAL PRIMARY KEY,
  chave     VARCHAR(190) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_limites_uso_chave_data ON limites_uso (chave, criado_em);
