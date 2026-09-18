-- ============================================================================
-- BARBEAR PRIME — Schema de produção (MySQL 8+)
-- ============================================================================
-- Este arquivo espelha fielmente a estrutura de dados usada hoje pelo
-- protótipo (localStorage, em database/db.js) — mesmos campos, mesmas
-- regras de negócio, prontos para virar tabelas reais.
--
-- Migrar o front-end para usar este banco significa, na prática, trocar
-- cada função de database/db.js por uma chamada HTTP a uma API que lê/grava
-- nestas tabelas. Os nomes de campo em camelCase do JS foram convertidos
-- para snake_case, mas o significado é o mesmo — a tabela de
-- correspondência está em MIGRACAO.md, nesta mesma pasta.
--
-- Como importar:
--   mysql -u seu_usuario -p < schema-mysql.sql
--   mysql -u seu_usuario -p barbear_prime < seed-mysql.sql
--
-- Este schema NÃO é para o Netlify em si — Netlify hospeda apenas o
-- front-end estático (HTML/CSS/JS). Veja README.md nesta pasta para as
-- opções de onde rodar este banco (PlanetScale, Railway, Supabase, etc.)
-- e como o front-end passaria a falar com ele.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS barbear_prime
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE barbear_prime;

-- ----------------------------------------------------------------------------
-- USUÁRIOS (clientes e equipe/barbeiros — mesma tabela, campo `papel` distingue)
-- ----------------------------------------------------------------------------
-- Corresponde a `bp_usuarios` no localStorage. Um usuário com papel='equipe'
-- é automaticamente um barbeiro selecionável no agendamento (getBarbeiros()).
CREATE TABLE usuarios (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  email          VARCHAR(190) NOT NULL,
  senha_hash     VARCHAR(255) NOT NULL,
  papel          ENUM('cliente', 'equipe') NOT NULL DEFAULT 'cliente',
  avatar_url     TEXT NULL,
  ativo          TINYINT(1) NOT NULL DEFAULT 1,
  -- 0 até o link do e-mail de confirmação ser clicado (ver
  -- verificacoes_email abaixo). NÃO bloqueia login — é informativo, do
  -- mesmo jeito que "esqueci minha senha" é um recurso disponível sem
  -- ser obrigatório.
  email_verificado TINYINT(1) NOT NULL DEFAULT 0,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_usuarios_email (email),
  KEY idx_usuarios_papel (papel)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO DE E-MAIL (token de uso único, enviado no cadastro)
-- ----------------------------------------------------------------------------
CREATE TABLE verificacoes_email (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  token_hash     CHAR(64) NOT NULL,
  expira_em      DATETIME NOT NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_verificacoes_email_token (token_hash),
  KEY idx_verificacoes_email_usuario (usuario_id),
  CONSTRAINT fk_verificacoes_email_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- RECUPERAÇÃO DE SENHA ("esqueci minha senha", token de uso único)
-- ----------------------------------------------------------------------------
CREATE TABLE recuperacoes_senha (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  token_hash     CHAR(64) NOT NULL,
  expira_em      DATETIME NOT NULL,
  usado_em       DATETIME NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_recuperacoes_senha_token (token_hash),
  KEY idx_recuperacoes_senha_usuario (usuario_id),
  CONSTRAINT fk_recuperacoes_senha_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- SESSÕES
-- ----------------------------------------------------------------------------
-- O protótipo guarda a sessão inteira em bp_sessao (localStorage), sem
-- expiração. Num backend real, use tokens com expiração — esta tabela é o
-- ponto de partida recomendado (ex.: JWT opaco, guardando só o hash).
CREATE TABLE sessoes (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  token_hash     CHAR(64) NOT NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em      DATETIME NOT NULL,

  UNIQUE KEY uq_sessoes_token_hash (token_hash),
  KEY idx_sessoes_usuario (usuario_id),
  CONSTRAINT fk_sessoes_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- SERVIÇOS (catálogo editável pela equipe — CRUD em painel-barbeiro.html)
-- ----------------------------------------------------------------------------
-- Corresponde a `bp_servicos`. `destaque` reflete a lista de "Serviços em
-- destaque" da Home (antes guardada à parte em bp_config.servicosDestaque;
-- aqui é só uma coluna, mais simples de consultar).
CREATE TABLE servicos (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  descricao      TEXT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  duracao_min    INT UNSIGNED NOT NULL DEFAULT 30,
  ativo          TINYINT(1) NOT NULL DEFAULT 1,
  destaque       TINYINT(1) NOT NULL DEFAULT 0,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_servicos_destaque (destaque),
  KEY idx_servicos_nome (nome)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- AGENDAMENTOS
-- ----------------------------------------------------------------------------
-- Corresponde a `bp_agendamentos`. Pontos importantes que replicam regras
-- de negócio já implementadas no front-end:
--
-- 1) usuario_id é NULL quando o agendamento foi criado pela equipe para um
--    cliente sem conta (criarAgendamentoEquipe) — nesse caso, cliente_nome
--    guarda o nome digitado na hora.
-- 2) barbeiro_id identifica qual conta de equipe atende o agendamento —
--    parte do suporte a múltiplos barbeiros, cada um com a própria agenda.
-- 3) Serviços com duração > 60min ocupam mais de um horário em sequência
--    (ex.: Reflexo/Nevou). A relação completa de horários ocupados fica em
--    agendamento_horarios, abaixo — hora_inicio aqui é só o primeiro deles.
CREATE TABLE agendamentos (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id          BIGINT UNSIGNED NULL,
  cliente_nome        VARCHAR(120) NOT NULL,
  barbeiro_id         BIGINT UNSIGNED NULL,
  data_servico        DATE NOT NULL,
  hora_inicio         TIME NOT NULL,
  status              ENUM('pendente', 'confirmado', 'cancelado') NOT NULL DEFAULT 'pendente',
  criado_pela_equipe  TINYINT(1) NOT NULL DEFAULT 0,
  criado_em           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_agendamentos_usuario (usuario_id),
  KEY idx_agendamentos_barbeiro (barbeiro_id),
  KEY idx_agendamentos_data_hora (data_servico, hora_inicio),
  CONSTRAINT fk_agendamentos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agendamentos_barbeiro
    FOREIGN KEY (barbeiro_id) REFERENCES usuarios (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- HORÁRIOS OCUPADOS POR AGENDAMENTO (suporte a serviços de 2+ slots)
-- ----------------------------------------------------------------------------
-- Corresponde a `horariosOcupados` (array) dentro de cada agendamento no
-- localStorage. Um agendamento de 70min (ex.: Reflexo) ocupa 2 linhas aqui
-- — isso é o que a consulta de disponibilidade (getHorariosDisponiveis)
-- deve checar, não só hora_inicio.
CREATE TABLE agendamento_horarios (
  agendamento_id BIGINT UNSIGNED NOT NULL,
  hora           TIME NOT NULL,

  PRIMARY KEY (agendamento_id, hora),
  CONSTRAINT fk_agendamento_horarios_agendamento
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- SERVIÇOS DE CADA AGENDAMENTO (com snapshot de preço/nome)
-- ----------------------------------------------------------------------------
-- Corresponde a `servicoIds` + `servicosSnapshot` no localStorage. Esta é a
-- regra de negócio mais importante do sistema: nome_snapshot e
-- preco_centavos_snapshot são gravados no momento da marcação (ou
-- remarcação) e NUNCA mudam depois — mesmo que o serviço original seja
-- editado ou excluído do catálogo. Isso é o que garante que editar um
-- serviço não altera o valor de quem já agendou.
CREATE TABLE agendamento_servicos (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agendamento_id         BIGINT UNSIGNED NOT NULL,
  servico_id             BIGINT UNSIGNED NULL, -- NULL se o serviço original foi excluído do catálogo depois
  nome_snapshot          VARCHAR(120) NOT NULL,
  preco_centavos_snapshot INT UNSIGNED NOT NULL,

  INDEX idx_agendamento_servicos_agendamento (agendamento_id),
  CONSTRAINT fk_agendamento_servicos_agendamento
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_agendamento_servicos_servico
    FOREIGN KEY (servico_id) REFERENCES servicos (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PREFERÊNCIAS DE CORTE (uma linha por cliente)
-- ----------------------------------------------------------------------------
-- Corresponde a `bp_preferencias_corte`, indexado por usuário no localStorage.
CREATE TABLE preferencias_corte (
  usuario_id      BIGINT UNSIGNED PRIMARY KEY,
  tamanho_cabelo  VARCHAR(40) NULL,
  tipo_degrade    VARCHAR(40) NULL,
  acabamento      VARCHAR(40) NULL,
  estilo_barba    VARCHAR(40) NULL,
  notas           TEXT NULL,
  atualizado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_preferencias_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- CONFIGURAÇÃO GERAL DO APP (banner, chave-valor solta)
-- ----------------------------------------------------------------------------
-- Corresponde a `bp_config` no localStorage, que hoje guarda um JSON solto
-- (banner da barbearia em base64). Aqui vira uma tabela chave-valor simples,
-- já que é configuração única do estabelecimento (não por usuário).
-- `servicosDestaque` e `somNotificacao/somPersonalizado` saíram desta tabela
-- porque viraram, respectivamente, a coluna servicos.destaque e a tabela
-- preferencias_notificacao (abaixo) — mais corretas normalizadas.
CREATE TABLE config_app (
  chave          VARCHAR(60) PRIMARY KEY,
  valor          TEXT NULL,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PREFERÊNCIAS DE NOTIFICAÇÃO (uma linha por cliente)
-- ----------------------------------------------------------------------------
-- Corresponde às chaves notifAgendamentos / notifOfertas / somNotificacao /
-- somPersonalizado dentro de bp_config — hoje guardadas globalmente no
-- protótipo (localStorage é por navegador, então já é "por pessoa" na
-- prática). Num banco real, compartilhado entre usuários, isso precisa
-- ser por usuário — daí esta tabela.
CREATE TABLE preferencias_notificacao (
  usuario_id             BIGINT UNSIGNED PRIMARY KEY,
  notif_agendamentos     TINYINT(1) NOT NULL DEFAULT 1,
  notif_ofertas          TINYINT(1) NOT NULL DEFAULT 0,
  som_notificacao        ENUM('padrao', 'sino', 'navalha', 'personalizado', 'silencioso') NOT NULL DEFAULT 'padrao',
  som_personalizado_url  TEXT NULL, -- link para o arquivo de áudio (ver README.md sobre upload de mídia)
  som_personalizado_nome VARCHAR(190) NULL,
  atualizado_em          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_preferencias_notif_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- TENTATIVAS DE LOGIN (auditoria/rate limit básico)
-- ----------------------------------------------------------------------------
-- Não existe no protótipo (localStorage não registra isso), mas é
-- recomendado para qualquer backend real de autenticação.
CREATE TABLE tentativas_login (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(190) NOT NULL,
  sucesso        TINYINT(1) NOT NULL,
  ip             VARCHAR(45) NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_tentativas_email_data (email, criado_em)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- BLOQUEIOS DE AGENDA (dia de folga ou horário específico bloqueado)
-- ----------------------------------------------------------------------------
-- hora NULL = dia inteiro bloqueado; hora preenchida = só aquele horário.
CREATE TABLE bloqueios_agenda (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barbeiro_id    BIGINT UNSIGNED NOT NULL,
  data           DATE NOT NULL,
  hora           TIME NULL,
  motivo         VARCHAR(120) NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_bloqueios_barbeiro_data (barbeiro_id, data),
  UNIQUE KEY idx_bloqueios_horario_unico (barbeiro_id, data, hora),
  CONSTRAINT fk_bloqueios_barbeiro
    FOREIGN KEY (barbeiro_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
