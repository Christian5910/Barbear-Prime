/**
 * Cliente Postgres (Neon) compartilhado por todas as Netlify Functions.
 * ============================================================================
 * Usa @neondatabase/serverless, que funciona sobre HTTP/WebSocket — feito
 * sob medida para ambientes serverless como Netlify Functions, onde uma
 * conexão TCP tradicional (como o driver `pg` usa) não se comporta bem
 * (cada invocação é isolada e de vida curta).
 *
 * Variável de ambiente necessária (configurar no painel do Netlify em
 * Site settings → Environment variables):
 *   DATABASE_URL = a "connection string" que o Neon fornece no dashboard
 *                  (algo como postgres://usuario:senha@ep-xxxx.neon.tech/barbear_prime?sslmode=require)
 */
const { neon } = require('@neondatabase/serverless');

let sqlClient = null;

function getSql() {
  if (!sqlClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não configurada. Veja DEPLOY.md na raiz do projeto.');
    }
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

module.exports = { getSql };
