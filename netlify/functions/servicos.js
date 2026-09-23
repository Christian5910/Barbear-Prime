/**
 * /api/servicos
 *   GET    — lista todos os serviços ativos, em ordem alfabética
 *   POST   — cria um serviço novo (requer sessão de equipe)
 *
 * /api/servicos/:id  (roteado via querystring ?id=... pelo netlify.toml)
 *   PUT    — atualiza um serviço (requer sessão de equipe)
 *   DELETE — soft delete (ativo = false), preserva o histórico de
 *            agendamentos que já usaram esse serviço (requer sessão de equipe)
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, idDaRequisicao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');

function paraCentavos(valorEmReais) {
  return Math.round(Number(valorEmReais) * 100);
}

function paraApi(linha) {
  return {
    id: String(linha.id),
    nome: linha.nome,
    descricao: linha.descricao || '',
    preco: linha.preco_centavos / 100,
    duracaoMin: linha.duracao_min,
    destaque: Boolean(linha.destaque),
  };
}

exports.handler = async (event) => {
  const sql = getSql();
  const id = idDaRequisicao(event);

  if (event.httpMethod === 'GET') {
    const linhas = await sql`
      SELECT * FROM servicos WHERE ativo = TRUE ORDER BY nome COLLATE "und-x-icu" ASC
    `;
    return json(200, { servicos: linhas.map(paraApi) });
  }

  // Todas as escritas exigem o barbeiro MASTER — um barbeiro comum só
  // mexe na própria agenda (ver bloqueios-agenda.js e agendamentos.js),
  // não no catálogo de serviços da barbearia inteira.
  const usuario = await getUsuarioDaSessao(event);
  if (!usuario || usuario.papel !== 'equipe' || !usuario.master) {
    return erro(403, 'Apenas o barbeiro master pode gerenciar serviços.');
  }

  if (event.httpMethod === 'POST') {
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const nome = String(dados.nome || '').trim();
    const preco = Number(dados.preco);
    const duracaoMin = Number(dados.duracaoMin) || 30;
    const descricao = String(dados.descricao || '').trim();

    if (!nome || !Number.isFinite(preco) || preco <= 0) {
      return erro(400, 'Preencha nome e um preço válido.');
    }
    // servicos.nome é VARCHAR(120) no banco — mesma lógica das outras
    // checagens de tamanho adicionadas nesta rodada (ver auth-cadastro.js).
    if (nome.length > 120) return erro(400, 'Nome do serviço muito longo (máximo 120 caracteres).');

    const [novo] = await sql`
      INSERT INTO servicos (nome, descricao, preco_centavos, duracao_min)
      VALUES (${nome}, ${descricao}, ${paraCentavos(preco)}, ${duracaoMin})
      RETURNING *
    `;
    return json(201, { servico: paraApi(novo) });
  }

  if (event.httpMethod === 'PUT') {
    if (!id) return erro(400, 'Informe o id do serviço na URL.');
    const dados = corpoJson(event);
    if (!dados) return erro(400, 'JSON inválido.');

    const atuais = await sql`SELECT * FROM servicos WHERE id = ${id} LIMIT 1`;
    if (!atuais.length) return erro(404, 'Serviço não encontrado.');
    const atual = atuais[0];

    const nome = dados.nome !== undefined ? String(dados.nome).trim() : atual.nome;
    const preco = dados.preco !== undefined ? Number(dados.preco) : atual.preco_centavos / 100;
    const duracaoMin = dados.duracaoMin !== undefined ? (Number(dados.duracaoMin) || atual.duracao_min) : atual.duracao_min;
    const descricao = dados.descricao !== undefined ? String(dados.descricao).trim() : (atual.descricao || '');
    // O front-end (seleção de "serviços em destaque" no Painel do
    // Barbeiro) manda updates só com { destaque } — sem isso, aquele
    // PUT nunca alterava a coluna e o clique nos chips parecia
    // funcionar (toast de sucesso) mas o destaque nunca persistia.
    const destaque = dados.destaque !== undefined ? Boolean(dados.destaque) : atual.destaque;

    if (!nome || !Number.isFinite(preco) || preco <= 0) {
      return erro(400, 'Preencha nome e um preço válido.');
    }
    if (nome.length > 120) return erro(400, 'Nome do serviço muito longo (máximo 120 caracteres).');

    // IMPORTANTE: esta atualização NUNCA toca em agendamento_servicos —
    // o snapshot de nome/preço gravado na hora da marcação permanece
    // intacto. Só agendamentos novos ou remarcados usam este valor novo.
    const [atualizado] = await sql`
      UPDATE servicos
      SET nome = ${nome}, descricao = ${descricao}, preco_centavos = ${paraCentavos(preco)}, duracao_min = ${duracaoMin}, destaque = ${destaque}
      WHERE id = ${id}
      RETURNING *
    `;
    return json(200, { servico: paraApi(atualizado) });
  }

  if (event.httpMethod === 'DELETE') {
    if (!id) return erro(400, 'Informe o id do serviço na URL.');

    // Soft delete: preserva o histórico de agendamentos que referenciam
    // este serviço (via servico_id em agendamento_servicos, com ON DELETE
    // SET NULL só se algum dia for excluído de verdade).
    await sql`UPDATE servicos SET ativo = FALSE, destaque = FALSE WHERE id = ${id}`;
    return json(200, { ok: true });
  }

  return metodoNaoPermitido(['GET', 'POST', 'PUT', 'DELETE']);
};
