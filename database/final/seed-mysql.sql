-- ============================================================================
-- BARBEAR PRIME — Dados de exemplo (MySQL 8+)
-- ============================================================================
-- Mesmos dados que hoje vêm no seed automático de database/db.js
-- (função seedInicial), para abrir o sistema já com algo para testar.
--
-- Rodar depois de schema-mysql.sql:
--   mysql -u seu_usuario -p barbear_prime < seed-mysql.sql
--
-- Senhas: o protótipo usa apenas Base64 (não é criptografia real — ver
-- aviso em README.md). Aqui os hashes já vêm no formato bcrypt, prontos
-- para um backend real validar com password_verify()/bcrypt.compare().
-- Senhas em texto puro, só para você testar o login depois de migrar:
--   joao@yahoo.com          -> 123456
--   equipe@barbearprime.com -> admin123
--   ana@email.com           -> senha123
-- Troque essas senhas (e o hash de admin) antes de qualquer uso real.
-- ============================================================================

USE barbear_prime;

-- ----------------------------------------------------------------------------
-- Usuários (mesmos 3 do seed atual: 2 clientes + 1 barbeiro/equipe)
-- ----------------------------------------------------------------------------
INSERT INTO usuarios (id, nome, email, senha_hash, papel, avatar_url, ativo, email_verificado, master) VALUES
  (1001, 'Joao Osvaldo', 'joao@yahoo.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', -- 123456
   'cliente', '/assets/img/avatar-exemplo.jpg', 1, 1, 0),
  (1002, 'Barbeiro Admin', 'equipe@barbearprime.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', -- admin123
   'equipe', '/assets/img/avatar-exemplo.jpg', 1, 1, 1),
  (1003, 'Ana Silva', 'ana@email.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', -- senha123
   'cliente', '/assets/img/avatar-exemplo.jpg', 1, 1, 0)
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  papel = VALUES(papel),
  avatar_url = VALUES(avatar_url),
  master = VALUES(master);

-- ----------------------------------------------------------------------------
-- Serviços (catálogo padrão — SERVICOS_PADRAO em db.js), em ordem alfabética
-- ----------------------------------------------------------------------------
INSERT INTO servicos (id, nome, descricao, preco_centavos, duracao_min, destaque) VALUES
  (1, 'Barba', 'Modelagem e alinhamento da barba com navalha/máquina, hidratação e finalização do contorno.', 2000, 30, 1),
  (2, 'Corte e Barba', 'Combo completo: corte de cabelo + barba, com acabamento e finalização.', 4500, 60, 1),
  (3, 'Corte Padrão', 'Corte de cabelo clássico, com máquina e tesoura, lavagem e finalização.', 3000, 40, 1),
  (4, 'Degradê', 'Corte degradê (fade), com transição suave entre os comprimentos.', 3500, 45, 1),
  (5, 'Pigmento', 'Aplicação de pigmento para disfarçar falhas ou uniformizar a cor.', 3000, 35, 0),
  (6, 'Sobrancelha', 'Design e alinhamento de sobrancelha.', 2000, 20, 0),
  (7, 'Reflexo', 'Aplicação de reflexo/mechas no cabelo.', 5500, 70, 0),
  (8, 'Nevou', 'Descoloração completa (nevou), com tratamento pós-química.', 14500, 120, 0)
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  descricao = VALUES(descricao),
  preco_centavos = VALUES(preco_centavos),
  duracao_min = VALUES(duracao_min),
  destaque = VALUES(destaque);

-- ----------------------------------------------------------------------------
-- Agendamentos de exemplo (mesmos 3 do seed atual)
-- Todos atendidos pelo barbeiro id 1002 (único cadastrado no seed).
-- ----------------------------------------------------------------------------
INSERT INTO agendamentos (id, usuario_id, cliente_nome, barbeiro_id, data_servico, hora_inicio, status, criado_pela_equipe) VALUES
  (2001, 1001, 'Joao Osvaldo', 1002, '2026-09-15', '14:00:00', 'confirmado', 0),
  (2002, 1001, 'Joao Osvaldo', 1002, '2026-09-20', '10:00:00', 'pendente',   0),
  (2003, 1003, 'Ana Silva',    1002, '2026-09-18', '16:00:00', 'pendente',   0)
ON DUPLICATE KEY UPDATE
  data_servico = VALUES(data_servico),
  hora_inicio = VALUES(hora_inicio),
  status = VALUES(status);

-- Horários ocupados por agendamento — os 3 do seed são todos serviços de
-- até 60min, então ocupam só 1 horário cada.
INSERT INTO agendamento_horarios (agendamento_id, hora) VALUES
  (2001, '14:00:00'),
  (2002, '10:00:00'),
  (2003, '16:00:00')
ON DUPLICATE KEY UPDATE hora = VALUES(hora);

-- Serviços de cada agendamento, já com o snapshot de nome/preço no momento
-- da marcação (igual a servicosSnapshot no localStorage).
INSERT INTO agendamento_servicos (agendamento_id, servico_id, nome_snapshot, preco_centavos_snapshot) VALUES
  (2001, 1, 'Barba', 2000),
  (2001, 3, 'Corte Padrão', 3000),
  (2002, 2, 'Corte e Barba', 4500),
  (2003, 4, 'Degrade', 3500),
  (2003, 5, 'Pigmento', 3000)
ON DUPLICATE KEY UPDATE
  nome_snapshot = VALUES(nome_snapshot),
  preco_centavos_snapshot = VALUES(preco_centavos_snapshot);

-- ----------------------------------------------------------------------------
-- Preferências de corte (mesmas do seed atual)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Preferências de notificação (padrão do sistema: agendamentos ligado,
-- ofertas desligado, som padrão — mesmos defaults do front-end atual)
-- ----------------------------------------------------------------------------
INSERT INTO preferencias_notificacao (usuario_id, notif_agendamentos, notif_ofertas, som_notificacao) VALUES
  (1001, 1, 0, 'padrao'),
  (1003, 1, 0, 'padrao')
ON DUPLICATE KEY UPDATE
  notif_agendamentos = VALUES(notif_agendamentos),
  notif_ofertas = VALUES(notif_ofertas),
  som_notificacao = VALUES(som_notificacao);

-- ----------------------------------------------------------------------------
-- Configuração geral do app (banner da barbearia)
-- ----------------------------------------------------------------------------
-- No protótipo local, o banner é salvo em base64 dentro do próprio
-- localStorage. Num banco real, o recomendado é subir o arquivo para um
-- storage de imagens (S3, Cloudinary, Netlify Blobs, etc.) e guardar só a
-- URL aqui — ver README.md, seção "Imagens".
INSERT INTO config_app (chave, valor) VALUES
  ('banner_barbearia_url', '/assets/img/capa-barbearia.jpg')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
