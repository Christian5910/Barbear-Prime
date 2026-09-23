/**
 * /api/preferencias-corte/:usuarioId
 *   GET — devolve as preferências de corte do usuário
 *   PUT — salva/atualiza (upsert)
 *
 * Só o próprio usuário (ou a equipe) pode ler/gravar suas preferências.
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, idDaRequisicao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');

function paraApi(linha) {
  if (!linha) return null;
  return {
    tamanhoCabelo: linha.tamanho_cabelo,
    tipoDegrade: linha.tipo_degrade,
    acabamento: linha.acabamento,
    estiloBarba: linha.estilo_barba,
    notas: linha.notas,
  };
}

exports.handler = async (event) => {
  const usuarioId = idDaRequisicao(event, 'usuarioId');
  if (!usuarioId) return erro(400, 'Informe o usuarioId.');

  const usuarioLogado = await getUsuarioDaSessao(event);
  if (!usuarioLogado) return erro(401, 'Entre na sua conta para continuar.');
  if (String(usuarioLogado.id) !== String(usuarioId) && usuarioLogado.papel !== 'equipe') {
    return erro(403, 'Sem permissão para acessar estas preferências.');
  }

  const sql = getSql();

  if (event.httpMethod === 'GET') {
    const linhas = await sql`SELECT * FROM preferencias_corte WHERE usuario_id = ${usuarioId} LIMIT 1`;
    return json(200, { preferencias: paraApi(linhas[0]) });
  }

  if (event.httpMethod === 'PUT') {
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    // tamanho_cabelo/tipo_degrade/acabamento/estilo_barba são VARCHAR(40)
    // no banco (vêm de <select> no front-end, mas nada impede um valor
    // maior via chamada direta à API) — sem checar aqui, viraria um erro
    // 500 cru do Postgres em vez de uma mensagem clara.
    for (const [campo, rotulo] of [
      ['tamanhoCabelo', 'Tamanho de cabelo'],
      ['tipoDegrade', 'Tipo de degradê'],
      ['acabamento', 'Acabamento'],
      ['estiloBarba', 'Estilo de barba'],
    ]) {
      if (dados[campo] && String(dados[campo]).length > 40) {
        return erro(400, `${rotulo} muito longo (máximo 40 caracteres).`);
      }
    }

    const [salvo] = await sql`
      INSERT INTO preferencias_corte (usuario_id, tamanho_cabelo, tipo_degrade, acabamento, estilo_barba, notas)
      VALUES (${usuarioId}, ${dados.tamanhoCabelo || null}, ${dados.tipoDegrade || null}, ${dados.acabamento || null}, ${dados.estiloBarba || null}, ${dados.notas || null})
      ON CONFLICT (usuario_id) DO UPDATE SET
        tamanho_cabelo = EXCLUDED.tamanho_cabelo,
        tipo_degrade = EXCLUDED.tipo_degrade,
        acabamento = EXCLUDED.acabamento,
        estilo_barba = EXCLUDED.estilo_barba,
        notas = EXCLUDED.notas
      RETURNING *
    `;
    return json(200, { preferencias: paraApi(salvo) });
  }

  return metodoNaoPermitido(['GET', 'PUT']);
};
