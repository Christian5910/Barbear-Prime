-- ============================================================================
-- MIGRAÇÃO: hierarquia master/filho entre contas de equipe
-- ============================================================================
-- Rode isto se o seu banco já existia antes desta versão (um banco criado
-- do zero com schema-postgresql.sql atual já nasce com a coluna certa).
--
-- Depois de rodar, TODA conta de equipe fica com master = FALSE — você
-- precisa escolher manualmente qual barbeiro é o master (ver o UPDATE
-- comentado no fim deste arquivo). Enquanto nenhuma conta for marcada como
-- master, ninguém consegue criar novo barbeiro, editar endereço/serviços
-- nem trocar o banner do painel — ver netlify/functions/auth-cadastro.js,
-- config.js, servicos.js e upload.js.
-- ============================================================================

ALTER TABLE usuarios
  ADD COLUMN master BOOLEAN NOT NULL DEFAULT FALSE;

-- Garante no máximo uma conta master por vez, também no nível do banco
-- (não só na lógica das functions) — ver comentário completo em
-- schema-postgresql.sql.
CREATE UNIQUE INDEX idx_usuarios_master_unico ON usuarios (master) WHERE master = TRUE;

-- Descomente a linha abaixo, trocando o e-mail pelo do barbeiro que deve
-- virar o master (normalmente o dono da barbearia). Só funciona pra uma
-- conta com papel = 'equipe' — marcar um cliente como master não tem
-- efeito nenhum (as checagens do backend sempre conferem papel E master
-- juntos).
--
-- UPDATE usuarios SET master = TRUE WHERE email = 'dono@suabarbearia.com';
