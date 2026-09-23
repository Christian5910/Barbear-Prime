-- ============================================================================
-- BARBEAR PRIME — Schema pronto para backend/deploy
-- MySQL 8+. O prototipo atual usa localStorage em database/db.js, mas as
-- tabelas abaixo espelham a mesma estrutura para migracao posterior.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS barbear_prime
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE barbear_prime;

CREATE TABLE usuarios (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  email          VARCHAR(190) NOT NULL,
  senha_hash     VARCHAR(255) NOT NULL,
  papel          ENUM('cliente', 'equipe') NOT NULL DEFAULT 'cliente',
  avatar_url     TEXT NULL,
  ativo          TINYINT(1) NOT NULL DEFAULT 1,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_usuarios_email (email),
  KEY idx_usuarios_papel (papel)
) ENGINE=InnoDB;

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

CREATE TABLE servicos (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  descricao      TEXT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  duracao_min    INT UNSIGNED NOT NULL DEFAULT 30,
  ativo          TINYINT(1) NOT NULL DEFAULT 1,
  destaque       TINYINT(1) NOT NULL DEFAULT 0,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE agendamentos (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  data_servico    DATE NOT NULL,
  hora_servico    TIME NOT NULL,
  status         ENUM('pendente', 'confirmado', 'cancelado') NOT NULL DEFAULT 'pendente',
  observacoes    TEXT NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_agendamentos_usuario (usuario_id),
  KEY idx_agendamentos_data_hora (data_servico, hora_servico),
  CONSTRAINT fk_agendamentos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agendamento_servicos (
  agendamento_id BIGINT UNSIGNED NOT NULL,
  servico_id      BIGINT UNSIGNED NOT NULL,
  preco_centavos  INT UNSIGNED NOT NULL,

  PRIMARY KEY (agendamento_id, servico_id),
  CONSTRAINT fk_agendamento_servicos_agendamento
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_agendamento_servicos_servico
    FOREIGN KEY (servico_id) REFERENCES servicos (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

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

CREATE TABLE tentativas_login (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(190) NOT NULL,
  sucesso        TINYINT(1) NOT NULL,
  ip             VARCHAR(45) NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_tentativas_email_data (email, criado_em)
) ENGINE=InnoDB;

INSERT INTO servicos (id, nome, descricao, preco_centavos, duracao_min, destaque) VALUES
  (1, 'Barba', 'Modelagem e alinhamento da barba com navalha, máquina e finalização do contorno.', 2000, 30, 1),
  (2, 'Corte e Barba', 'Combo completo de corte de cabelo e barba com acabamento na navalha.', 4500, 60, 1),
  (3, 'Corte Padrão', 'Corte de cabelo tradicional com tesoura e máquina.', 3000, 40, 1),
  (4, 'Degradê', 'Corte degradê com transição bem acabada.', 3500, 45, 1),
  (5, 'Pigmento', 'Aplicação de pigmento capilar para disfarçar falhas ou embranquecimento.', 3000, 35, 0),
  (6, 'Sobrancelha', 'Design e alinhamento de sobrancelha na navalha.', 2000, 20, 0),
  (7, 'Reflexo', 'Aplicação de reflexo e mechas.', 5500, 70, 0),
  (8, 'Nevou', 'Descoloração completa estilo nevou.', 14500, 120, 0)
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  descricao = VALUES(descricao),
  preco_centavos = VALUES(preco_centavos),
  duracao_min = VALUES(duracao_min),
  destaque = VALUES(destaque);

INSERT INTO usuarios (id, nome, email, senha_hash, papel, avatar_url) VALUES
  (1001, 'Joao Osvaldo', 'joao@yahoo.com', '123456', 'cliente', 'assets/img/avatar-exemplo.jpg'),
  (1002, 'Barbeiro Admin', 'equipe@barbearprime.com', 'admin123', 'equipe', 'assets/img/avatar-exemplo.jpg'),
  (1003, 'Ana Silva', 'ana@email.com', 'senha123', 'cliente', 'assets/img/avatar-exemplo.jpg')
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  papel = VALUES(papel),
  avatar_url = VALUES(avatar_url);

INSERT INTO agendamentos (id, usuario_id, data_servico, hora_servico, status) VALUES
  (2001, 1001, '2026-09-15', '14:00:00', 'confirmado'),
  (2002, 1001, '2026-09-20', '10:00:00', 'pendente'),
  (2003, 1003, '2026-09-18', '16:00:00', 'pendente')
ON DUPLICATE KEY UPDATE
  data_servico = VALUES(data_servico),
  hora_servico = VALUES(hora_servico),
  status = VALUES(status);

INSERT INTO agendamento_servicos (agendamento_id, servico_id, preco_centavos) VALUES
  (2001, 1, 2000),
  (2001, 3, 3000),
  (2002, 2, 4500),
  (2003, 4, 3500),
  (2003, 5, 3000)
ON DUPLICATE KEY UPDATE preco_centavos = VALUES(preco_centavos);

INSERT INTO preferencias_corte
  (usuario_id, tamanho_cabelo, tipo_degrade, acabamento, estilo_barba, notas)
VALUES
  (1001, 'medio', 'navalhado', 'arredondado', 'longa_cheia', 'Prefiro a nuca bem alinhada e o contorno da barba mais fechado.'),
  (1003, 'longo', 'sombreado', 'natural', 'feita_rasa', 'Gosto de um visual mais natural.')
ON DUPLICATE KEY UPDATE
  tamanho_cabelo = VALUES(tamanho_cabelo),
  tipo_degrade = VALUES(tipo_degrade),
  acabamento = VALUES(acabamento),
  estilo_barba = VALUES(estilo_barba),
  notas = VALUES(notas);
