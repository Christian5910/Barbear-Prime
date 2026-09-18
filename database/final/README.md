# Barbear Prime — pacote pronto para banco de dados real

Esta pasta contém tudo que é preciso para tirar os dados do protótipo (hoje
em `localStorage`, dentro de `database/db.js`) e colocá-los num banco SQL de
verdade, incluindo as imagens do site.

> **Nota:** o arquivo `database/schema.sql` (fora desta pasta) é uma versão
> antiga e desatualizada — não inclui múltiplos barbeiros, snapshot de
> preço/serviço, nem catálogo de serviços editável. Use os arquivos **desta
> pasta** (`database/final/`) como referência atual; o schema antigo pode
> ser removido quando não precisar mais dele.

## O que tem aqui

```
database/final/
├── README.md                    este arquivo
├── MIGRACAO.md                  tabela de correspondência: função JS → tabela SQL
├── schema-mysql.sql             estrutura das tabelas (MySQL 8+)
├── seed-mysql.sql               dados de exemplo (os mesmos 3 usuários/agendamentos do protótipo)
├── schema-postgresql.sql        mesma estrutura, para PostgreSQL 14+ (Supabase/Neon/Railway)
├── seed-postgresql.sql          dados de exemplo, versão PostgreSQL
├── schema-midia-mysql.sql       tabela opcional para guardar imagens dentro do banco
├── importar-imagens.js          script Node que gera o SQL de importação das imagens
└── images/                      cópia das imagens reais do site (logo, avatar, banner, ícones)
```

## Passo a passo — importar num banco MySQL

```bash
mysql -u seu_usuario -p < schema-mysql.sql
mysql -u seu_usuario -p barbear_prime < seed-mysql.sql
```

Isso cria o banco `barbear_prime`, todas as tabelas, e popula com os mesmos
dados de exemplo que o protótipo já usa (3 usuários, 3 agendamentos, 8
serviços). Funciona em qualquer MySQL — local (XAMPP/MAMP/Docker) ou
hospedado (PlanetScale, Railway, Amazon RDS, etc.).

## Passo a passo — importar num banco PostgreSQL

```bash
psql "sua_connection_string" -f schema-postgresql.sql
psql "sua_connection_string" -f seed-postgresql.sql
```

Mesma ideia, para quem preferir Postgres (Supabase, Neon, Railway também
oferecem Postgres gerenciado).

## Sobre as imagens

As imagens reais do site (logo, avatar de exemplo, banner da barbearia,
ícones do app) estão copiadas em `images/`. Existem **duas formas** de usar
essas imagens num sistema real — escolha uma:

### Opção A (recomendada): storage de arquivos + URL no banco

Suba os arquivos de `images/` para um storage de arquivos/CDN (Amazon S3,
Cloudinary, Firebase Storage, Netlify Blobs, Vercel Blob, Bunny CDN, etc.) e
guarde só a **URL resultante** nas colunas já preparadas para isso:

- `usuarios.avatar_url`
- `config_app.valor` (linha `chave = 'banner_barbearia_url'`)
- `preferencias_notificacao.som_personalizado_url`

Essa é a forma mais rápida de carregar e mais barata de manter — bancos SQL
não são feitos para servir arquivos binários grandes com performance.

### Opção B: guardar as imagens dentro do próprio banco SQL

Se preferir manter tudo num único banco (sem montar um storage separado),
use `schema-midia-mysql.sql` (cria uma tabela `midia` com coluna `LONGBLOB`)
e rode:

```bash
node importar-imagens.js > midia-insert.sql
mysql -u seu_usuario -p barbear_prime < schema-midia-mysql.sql
mysql -u seu_usuario -p barbear_prime < midia-insert.sql
```

O script lê cada arquivo de `images/` e gera um `INSERT` com o conteúdo em
hexadecimal (formato que o MySQL aceita nativamente via `UNHEX()`, sem
precisar de nenhuma biblioteca extra). Isso funciona, mas deixe claro que
sua API vai precisar de uma rota própria para servir essas imagens de volta
como resposta HTTP (lendo o BLOB e devolvendo com o `mime_type` certo) — um
banco SQL não serve arquivos como um servidor de arquivos serve.

## Sobre o Netlify, especificamente

Uma coisa importante para deixar clara: **o Netlify não hospeda banco de
dados SQL** (nem MySQL, nem PostgreSQL). O Netlify é um serviço de hospedagem
de **front-end estático** — ele é ótimo para servir os arquivos HTML/CSS/JS
deste projeto (é inclusive onde este site já pode ser publicado hoje, do
jeito que está, sem banco nenhum, já que atualmente tudo roda em
localStorage no navegador).

Para ligar este site publicado no Netlify a um banco de dados real, o
caminho é:

1. **Front-end continua no Netlify** — nenhuma mudança na hospedagem do
   site em si.
2. **Banco de dados roda em outro serviço**, que aceite MySQL ou PostgreSQL:
   PlanetScale, Railway, Supabase, Neon, Amazon RDS, DigitalOcean Managed
   Database, entre outros. Escolha um, importe os arquivos `schema-*.sql` e
   `seed-*.sql` correspondentes.
3. **Uma API fica entre o front-end e o banco** — o navegador nunca deve
   falar com o banco SQL diretamente (nem teria como, bancos SQL não
   aceitam conexão de dentro de uma página web por segurança). As opções
   mais simples de combinar com Netlify:
   - **Netlify Functions** (serverless, roda junto com o próprio site) —
     cada função vira um endpoint HTTP que a API do front-end chama, e ela
     é quem conversa com o banco.
   - Um backend separado (Node/Express, PHP, etc.) hospedado em qualquer
     lugar (Railway, Render, um VPS), com o Netlify só apontando as
     chamadas de API para lá.
4. **`database/db.js` vira um cliente HTTP** — hoje cada função ali lê e
   grava direto no `localStorage`; depois da migração, cada uma passa a
   fazer um `fetch()` para a API (endpoint equivalente), mantendo os mesmos
   nomes de função para não precisar reescrever `assets/src/ui.js`. Veja
   `MIGRACAO.md` para o mapeamento completo de qual tabela/consulta
   corresponde a cada função.

Resumindo: o **schema e os dados** desta pasta são o banco em si, prontos
para importar em qualquer serviço de MySQL/PostgreSQL — o Netlify entra
depois, hospedando o front-end e (opcionalmente) as funções serverless que
fazem a ponte com esse banco.

## Segurança — antes de qualquer uso real

- As senhas de exemplo no seed são só placeholders de hash — troque todas
  antes de expor o sistema publicamente.
- O protótipo usa Base64 como "hash" de senha (`hashSenha()` em `db.js`),
  que não protege nada — é só para não guardar texto puro num teste local.
  Um backend real precisa gerar hash com bcrypt ou argon2 no servidor.
- Nunca devolva a coluna `senha_hash` em nenhuma resposta de API.
