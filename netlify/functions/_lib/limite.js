/**
 * Limite de uso por chave (IP, usuário...), guardado na tabela limites_uso.
 * ============================================================================
 * Serve para frear abuso que o login não cobre: cadastro em massa, uploads
 * em sequência (cada um vai para o ImageKit e ocupa espaço), pedidos de
 * permissão repetidos. É um contador simples por janela de tempo; não
 * substitui um WAF, mas fecha a porta mais óbvia.
 *
 * Se a tabela ainda não existir (migração não rodada), o limite é ignorado e
 * o erro vai para o log, para o site nunca cair por causa dele.
 */

async function excedeuLimite(sql, chave, maximo, janelaMinutos) {
  try {
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM limites_uso
      WHERE chave = ${chave} AND criado_em > now() - make_interval(mins => ${janelaMinutos})
    `;
    return total >= maximo;
  } catch (e) {
    console.error('Limite de uso indisponível (rode a migração migracao-hierarquia-barbeiros.sql):', e.message);
    return false;
  }
}

async function registrarUso(sql, chave) {
  try {
    await sql`INSERT INTO limites_uso (chave) VALUES (${chave})`;
    // Faxina ocasional: 1 a cada ~50 registros apaga o que já passou de 2 dias.
    if (Math.random() < 0.02) {
      await sql`DELETE FROM limites_uso WHERE criado_em < now() - interval '2 days'`;
    }
  } catch (e) {
    console.error('Não foi possível registrar o uso:', e.message);
  }
}

module.exports = { excedeuLimite, registrarUso };
