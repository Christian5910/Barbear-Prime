-- ============================================================================
-- BARBEAR PRIME — Dados de exemplo (PostgreSQL 14+)
-- ============================================================================
-- Equivalente a seed-mysql.sql. Rodar depois de schema-postgresql.sql.
--
-- Senhas em texto puro para teste (troque tudo antes de qualquer uso real):
--   joao@yahoo.com          -> 123456
--   equipe@barbearprime.com -> admin123
--   ana@email.com           -> senha123
-- ============================================================================

INSERT INTO usuarios (id, nome, email, senha_hash, papel, avatar_url, ativo, email_verificado) VALUES
  (1001, 'Joao Osvaldo', 'joao@yahoo.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', 'cliente', '/assets/img/avatar-exemplo.jpg', TRUE, TRUE),
  (1002, 'Barbeiro Admin', 'equipe@barbearprime.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', 'equipe', '/assets/img/avatar-exemplo.jpg', TRUE, TRUE),
  (1003, 'Ana Silva', 'ana@email.com',
   '$2y$10$examplehashreplaceonrealsetup0000000000000000000000000000', 'cliente', '/assets/img/avatar-exemplo.jpg', TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, papel = EXCLUDED.papel, avatar_url = EXCLUDED.avatar_url, email_verificado = EXCLUDED.email_verificado;

-- Corrige a sequência do BIGSERIAL para não colidir com os IDs fixos acima.
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), (SELECT MAX(id) FROM usuarios));

INSERT INTO servicos (id, nome, descricao, preco_centavos, duracao_min, destaque) VALUES
  (1, 'Barba', 'Modelagem e alinhamento da barba com navalha/máquina, hidratação e finalização do contorno.', 2000, 30, TRUE),
  (2, 'Corte e Barba', 'Combo completo: corte de cabelo + barba, com acabamento e finalização.', 4500, 60, TRUE),
  (3, 'Corte Padrao', 'Corte de cabelo clássico, com máquina e tesoura, lavagem e finalização.', 3000, 40, TRUE),
  (4, 'Degrade', 'Corte degradê (fade), com transição suave entre os comprimentos.', 3500, 45, TRUE),
  (5, 'Pigmento', 'Aplicação de pigmento para disfarçar falhas ou uniformizar a cor.', 3000, 35, FALSE),
  (6, 'Sobrancelha', 'Design e alinhamento de sobrancelha.', 2000, 20, FALSE),
  (7, 'Reflexo', 'Aplicação de reflexo/mechas no cabelo.', 5500, 70, FALSE),
  (8, 'Nevou', 'Descoloração completa (nevou), com tratamento pós-química.', 14500, 120, FALSE)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_centavos = EXCLUDED.preco_centavos, duracao_min = EXCLUDED.duracao_min,
  destaque = EXCLUDED.destaque;

SELECT setval(pg_get_serial_sequence('servicos', 'id'), (SELECT MAX(id) FROM servicos));

INSERT INTO agendamentos (id, usuario_id, cliente_nome, barbeiro_id, data_servico, hora_inicio, status, criado_pela_equipe) VALUES
  (2001, 1001, 'Joao Osvaldo', 1002, '2026-09-15', '14:00:00', 'confirmado', FALSE),
  (2002, 1001, 'Joao Osvaldo', 1002, '2026-09-20', '10:00:00', 'pendente',   FALSE),
  (2003, 1003, 'Ana Silva',    1002, '2026-09-18', '16:00:00', 'pendente',   FALSE)
ON CONFLICT (id) DO UPDATE SET
  data_servico = EXCLUDED.data_servico, hora_inicio = EXCLUDED.hora_inicio, status = EXCLUDED.status;

SELECT setval(pg_get_serial_sequence('agendamentos', 'id'), (SELECT MAX(id) FROM agendamentos));

INSERT INTO agendamento_horarios (agendamento_id, hora) VALUES
  (2001, '14:00:00'), (2002, '10:00:00'), (2003, '16:00:00')
ON CONFLICT (agendamento_id, hora) DO NOTHING;

INSERT INTO agendamento_servicos (agendamento_id, servico_id, nome_snapshot, preco_centavos_snapshot) VALUES
  (2001, 1, 'Barba', 2000),
  (2001, 3, 'Corte Padrao', 3000),
  (2002, 2, 'Corte e Barba', 4500),
  (2003, 4, 'Degrade', 3500),
  (2003, 5, 'Pigmento', 3000)
ON CONFLICT (agendamento_id, nome_snapshot) DO UPDATE SET
  preco_centavos_snapshot = EXCLUDED.preco_centavos_snapshot;

INSERT INTO preferencias_corte (usuario_id, tamanho_cabelo, tipo_degrade, acabamento, estilo_barba, notas) VALUES
  (1001, 'medio', 'navalhado', 'arredondado', 'longa_cheia', 'Prefiro a nuca bem alinhada e o contorno da barba mais fechado.'),
  (1003, 'longo', 'sombreado', 'natural', 'feita_rasa', 'Gosto de um visual mais natural.')
ON CONFLICT (usuario_id) DO UPDATE SET
  tamanho_cabelo = EXCLUDED.tamanho_cabelo, tipo_degrade = EXCLUDED.tipo_degrade,
  acabamento = EXCLUDED.acabamento, estilo_barba = EXCLUDED.estilo_barba, notas = EXCLUDED.notas;

INSERT INTO preferencias_notificacao (usuario_id, notif_agendamentos, notif_ofertas, som_notificacao) VALUES
  (1001, TRUE, FALSE, 'padrao'),
  (1003, TRUE, FALSE, 'padrao')
ON CONFLICT (usuario_id) DO UPDATE SET
  notif_agendamentos = EXCLUDED.notif_agendamentos,
  notif_ofertas = EXCLUDED.notif_ofertas,
  som_notificacao = EXCLUDED.som_notificacao;

INSERT INTO config_app (chave, valor) VALUES
  ('banner_barbearia_url', '/assets/img/capa-barbearia.jpg')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
