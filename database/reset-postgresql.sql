-- ============================================================================
-- BARBEAR PRIME — RESET COMPLETO DOS DADOS (PostgreSQL / Neon)
-- ============================================================================
-- APAGA TUDO que está nas tabelas (contas, agendamentos, folgas, serviços,
-- preferências, sessões e configurações) e recoloca o estado inicial:
--
--   * 1 conta de barbeiro MASTER RAIZ (a original da barbearia: cria colegas,
--     edita serviços, endereço e banner, decide pedidos de permissão; não
--     pode ser excluída nem rebaixada)
--       e-mail: equipe@barbearprime.com
--       senha temporária: a que foi informada junto com este arquivo.
--       TROQUE a senha no primeiro acesso (Perfil > engrenagem > Nova senha).
--   * os 8 serviços do catálogo (4 em destaque)
--   * o endereço, os blocos de informação e o banner da Localização/Home
--
-- Nada de clientes nem agendamentos de exemplo: o site começa limpo.
-- Todo mundo que estiver logado é desconectado (as sessões são apagadas).
--
-- As tabelas existentes NÃO são apagadas, só esvaziadas. As colunas e
-- tabelas criadas nas últimas versões (master, notif_email_agendamentos,
-- hierarquia de barbeiros, limites de uso) são adicionadas se ainda não
-- existirem, então este arquivo também serve como migração para um banco
-- antigo.
--
-- Como rodar: Neon > SQL Editor > cole este arquivo inteiro > Run.
-- Ou: psql "$DATABASE_URL" -f reset-postgresql.sql
-- Tudo roda numa transação: se qualquer passo falhar, nada é apagado.
--
-- Quer outra senha para a conta master? Gere o hash e troque o valor de
-- senha_hash abaixo:
--   node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA', 12))"
-- ============================================================================

BEGIN;

-- 1) Garante as colunas e tabelas das últimas versões (não faz nada se já existirem)
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS master BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS master_raiz BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pode_criar_barbeiros BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS criado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;
-- O índice antigo permitia só UM master; agora a unicidade é da master raiz.
DROP INDEX IF EXISTS idx_usuarios_master_unico;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_master_raiz_unico
  ON usuarios (master_raiz) WHERE master_raiz = TRUE;
ALTER TABLE preferencias_notificacao
  ADD COLUMN IF NOT EXISTS notif_email_agendamentos BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS solicitacoes_criacao_barbeiro (
  id             BIGSERIAL PRIMARY KEY,
  solicitante_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status         VARCHAR(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'negada')),
  decidido_por   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_uma_pendente
  ON solicitacoes_criacao_barbeiro (solicitante_id) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS limites_uso (
  id        BIGSERIAL PRIMARY KEY,
  chave     VARCHAR(190) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_limites_uso_chave_data ON limites_uso (chave, criado_em);

-- 2) Apaga todos os dados e reinicia os contadores de id (só das tabelas
--    que existem neste banco)
DO $$
DECLARE
  tabela TEXT;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'agendamento_servicos', 'agendamento_horarios', 'agendamentos',
    'bloqueios_agenda', 'solicitacoes_criacao_barbeiro', 'limites_uso',
    'preferencias_notificacao', 'preferencias_corte',
    'recuperacoes_senha', 'verificacoes_email', 'sessoes', 'tentativas_login',
    'servicos', 'config_app', 'usuarios'
  ] LOOP
    IF to_regclass('public.' || tabela) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', tabela);
    END IF;
  END LOOP;
END $$;

-- 3) Conta master
INSERT INTO usuarios (nome, email, senha_hash, papel, avatar_url, ativo, email_verificado, master, master_raiz)
VALUES ('Barbeiro Admin', 'equipe@barbearprime.com',
        '$2b$12$ps59GZuSecHgUYhoHWudsez7DiwtvGSnJ3oCoJogtCkrrKEiEMNa.',
        'equipe', '/assets/img/avatar-exemplo.jpg', TRUE, TRUE, TRUE, TRUE);

INSERT INTO preferencias_notificacao (usuario_id, notif_agendamentos, notif_ofertas, notif_email_agendamentos, som_notificacao)
SELECT id, TRUE, FALSE, FALSE, 'padrao' FROM usuarios WHERE master_raiz = TRUE;

-- 4) Catálogo de serviços
INSERT INTO servicos (id, nome, descricao, preco_centavos, duracao_min, destaque) VALUES
  (1, 'Barba', 'Modelagem e alinhamento da barba com navalha/máquina, hidratação e finalização do contorno.', 2000, 30, TRUE),
  (2, 'Corte e Barba', 'Combo completo: corte de cabelo + barba, com acabamento e finalização.', 4500, 60, TRUE),
  (3, 'Corte Padrão', 'Corte de cabelo clássico, com máquina e tesoura, lavagem e finalização.', 3000, 40, TRUE),
  (4, 'Degradê', 'Corte degradê (fade), com transição suave entre os comprimentos.', 3500, 45, TRUE),
  (5, 'Pigmento', 'Aplicação de pigmento para disfarçar falhas ou uniformizar a cor.', 3000, 35, FALSE),
  (6, 'Sobrancelha', 'Design e alinhamento de sobrancelha.', 2000, 20, FALSE),
  (7, 'Reflexo', 'Aplicação de reflexo/mechas no cabelo.', 5500, 70, FALSE),
  (8, 'Nevou', 'Descoloração completa (nevou), com tratamento pós-química.', 14500, 120, FALSE);

SELECT setval(pg_get_serial_sequence('servicos', 'id'), (SELECT MAX(id) FROM servicos));

-- 5) Configurações do site (banner e Localização). Tudo o que a Home, o
--    Painel e a tela de Localização mostram vem daqui; o rótulo
--    "Barbearia · Cidade, UF" é derivado da linha 2 do endereço.
INSERT INTO config_app (chave, valor) VALUES
  ('banner_barbearia_url', '/assets/img/capa-barbearia.jpg'),
  ('banner_barbearia_ajuste', 'padrao'),
  ('home_faixa_valores', '[{"titulo":"Desde 2016","texto":"Barbearia de tradição na região"},{"titulo":"Equipe experiente","texto":"Cortes clássicos e modernos"},{"titulo":"Acabamento na navalha","texto":"Detalhe impecável em todo serviço"}]'),
  ('endereco_linha1', 'Rua dos Berimbau Duros, Nº666'),
  ('endereco_linha2', 'Bairro dos Perus, Xique-Xique, BA'),
  ('endereco_cep', ''),
  ('endereco_numero', ''),
  ('endereco_mapa_busca', 'Xique-Xique,BA'),
  ('localizacao_info_blocos', '[{"id":"horario","icone":null,"iconeBootstrap":"bi-clock","texto":"Ter a Sáb, 9h às 20h"},{"id":"telefone","icone":null,"iconeBootstrap":"bi-telephone","texto":"(74) 99999-0000"},{"id":"estacionamento","icone":null,"iconeBootstrap":"bi-car-front","texto":"Estacionamento próprio"}]');

COMMIT;

-- Conferência: deve mostrar 1 usuário (master raiz), 8 serviços e 9 configurações.
SELECT
  (SELECT COUNT(*) FROM usuarios)     AS usuarios,
  (SELECT COUNT(*) FROM usuarios WHERE master_raiz) AS masters_raiz,
  (SELECT COUNT(*) FROM servicos)     AS servicos,
  (SELECT COUNT(*) FROM config_app)   AS configuracoes,
  (SELECT COUNT(*) FROM agendamentos) AS agendamentos;
