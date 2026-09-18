/**
 * GET /api/barbeiros
 * Lista pública de barbeiros (usuários com papel='equipe' e ativos),
 * usada na etapa "Escolha o barbeiro" do agendamento do cliente.
 */
const { getSql } = require('./_lib/db');
const { json, metodoNaoPermitido } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return metodoNaoPermitido(['GET']);

  const sql = getSql();
  const linhas = await sql`
    SELECT id, nome, avatar_url
    FROM usuarios
    WHERE papel = 'equipe' AND ativo = TRUE
    ORDER BY nome
  `;

  const barbeiros = linhas.map(l => ({
    id: String(l.id),
    nome: l.nome,
    avatar: l.avatar_url,
  }));

  return json(200, { barbeiros });
};
