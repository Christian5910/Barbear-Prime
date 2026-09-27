/**
 * /api/equipe: hierarquia entre os barbeiros
 * ============================================================================
 * Níveis (ver database/final/schema-postgresql.sql):
 *   master raiz   a conta original. Única, nunca é excluída nem rebaixada.
 *   master        cria barbeiros (comuns ou master), edita serviços,
 *                 endereço, capa e decide os pedidos de permissão.
 *   barbeiro      mexe só na própria agenda. Pode receber de um master a
 *                 permissão de criar OUTROS BARBEIROS COMUNS (nunca master).
 *
 * Rotas (todas exigem sessão de equipe; o que cada nível pode está em cada
 * uma. O servidor decide tudo aqui, esconder botão na tela é só conveniência):
 *   GET  /api/equipe                      MASTER: lista a equipe e os pedidos pendentes
 *   GET  /api/equipe/resumo               MASTER: { pendentes } (usado para avisar novos pedidos)
 *   GET  /api/equipe/minha                BARBEIRO: minha permissão e meu último pedido
 *   POST /api/equipe/solicitar            BARBEIRO: pede permissão para criar barbeiros
 *   PUT  /api/equipe/solicitacoes/:id     MASTER: { decisao: 'aprovar' | 'negar' }
 *   PUT  /api/equipe/:id/permissao        MASTER: { podeCriarBarbeiros: boolean } (só em barbeiro comum)
 *   PUT  /api/equipe/:id/rebaixar         MASTER RAIZ: transforma outro master em barbeiro comum
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJsonLimitado: corpoJson, comProtecao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');
const { excedeuLimite, registrarUso } = require('./_lib/limite');

// Segmentos do caminho depois de "equipe" (funciona tanto com /api/equipe/...
// quanto com /.netlify/functions/equipe/...).
function subcaminho(event) {
  const partes = (event.path || '').split('/').filter(Boolean);
  const i = partes.lastIndexOf('equipe');
  return i === -1 ? [] : partes.slice(i + 1);
}

const ehId = (v) => typeof v === 'string' && /^\d{1,18}$/.test(v);

function membroParaApi(l) {
  return {
    id: String(l.id),
    nome: l.nome,
    email: l.email,
    avatar: l.avatar_url,
    master: Boolean(l.master),
    masterRaiz: Boolean(l.master_raiz),
    podeCriarBarbeiros: Boolean(l.pode_criar_barbeiros),
    criadoPor: l.criado_por ? String(l.criado_por) : null,
  };
}

exports.handler = comProtecao(async (event) => {
  const usuario = await getUsuarioDaSessao(event);
  if (!usuario || usuario.papel !== 'equipe') {
    return erro(403, 'Apenas a equipe pode acessar esta área.');
  }
  const ehMaster = Boolean(usuario.master);
  const sql = getSql();
  const caminho = subcaminho(event);
  const metodo = event.httpMethod;

  /* ------------------------------ leituras ------------------------------ */
  if (metodo === 'GET' && caminho.length === 0) {
    if (!ehMaster) return erro(403, 'Apenas um barbeiro master pode ver a equipe.');
    const membros = await sql`
      SELECT id, nome, email, avatar_url, master, master_raiz, pode_criar_barbeiros, criado_por
      FROM usuarios WHERE papel = 'equipe' AND ativo = TRUE
      ORDER BY master_raiz DESC, master DESC, nome
    `;
    const solicitacoes = await sql`
      SELECT s.id, s.solicitante_id, s.criado_em, u.nome, u.avatar_url
      FROM solicitacoes_criacao_barbeiro s
      JOIN usuarios u ON u.id = s.solicitante_id AND u.ativo = TRUE AND u.papel = 'equipe' AND u.master = FALSE
      WHERE s.status = 'pendente'
      ORDER BY s.criado_em
    `;
    return json(200, {
      membros: membros.map(membroParaApi),
      solicitacoes: solicitacoes.map((s) => ({
        id: String(s.id),
        solicitanteId: String(s.solicitante_id),
        nome: s.nome,
        avatar: s.avatar_url,
        criadoEm: new Date(s.criado_em).toISOString(),
      })),
    });
  }

  if (metodo === 'GET' && caminho[0] === 'resumo') {
    if (!ehMaster) return erro(403, 'Apenas um barbeiro master pode ver os pedidos.');
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total
      FROM solicitacoes_criacao_barbeiro s
      JOIN usuarios u ON u.id = s.solicitante_id AND u.ativo = TRUE AND u.papel = 'equipe' AND u.master = FALSE
      WHERE s.status = 'pendente'
    `;
    return json(200, { pendentes: total });
  }

  if (metodo === 'GET' && caminho[0] === 'minha') {
    const [ultima] = await sql`
      SELECT status, criado_em, decidido_em FROM solicitacoes_criacao_barbeiro
      WHERE solicitante_id = ${usuario.id} ORDER BY id DESC LIMIT 1
    `;
    return json(200, {
      master: ehMaster,
      podeCriarBarbeiros: ehMaster || Boolean(usuario.pode_criar_barbeiros),
      solicitacao: ultima ? { status: ultima.status } : null,
    });
  }

  /* -------------------- barbeiro comum pede permissão -------------------- */
  if (metodo === 'POST' && caminho[0] === 'solicitar') {
    if (ehMaster) return erro(409, 'Um barbeiro master já pode criar barbeiros.');
    if (usuario.pode_criar_barbeiros) return erro(409, 'Você já tem essa permissão.');

    const chave = `solicitar-barbeiro:${usuario.id}`;
    if (await excedeuLimite(sql, chave, 3, 24 * 60)) {
      return erro(429, 'Você já fez pedidos demais hoje. Aguarde a resposta de um master.');
    }
    // O índice único parcial garante um pedido pendente por pessoa, mesmo
    // com dois cliques ao mesmo tempo.
    const criada = await sql`
      INSERT INTO solicitacoes_criacao_barbeiro (solicitante_id) VALUES (${usuario.id})
      ON CONFLICT DO NOTHING RETURNING id
    `;
    if (!criada.length) return erro(409, 'Você já tem um pedido aguardando resposta.');
    await registrarUso(sql, chave);
    return json(201, { ok: true });
  }

  /* ---------------------------- só master daqui ---------------------------- */
  if (!ehMaster) return erro(403, 'Apenas um barbeiro master pode fazer isso.');

  // PUT /api/equipe/solicitacoes/:id
  if (metodo === 'PUT' && caminho[0] === 'solicitacoes' && ehId(caminho[1])) {
    const dados = corpoJson(event);
    if (!dados || !['aprovar', 'negar'].includes(dados.decisao)) {
      return erro(400, 'Informe a decisão: "aprovar" ou "negar".');
    }
    const novoStatus = dados.decisao === 'aprovar' ? 'aprovada' : 'negada';

    // Atômico: só decide se ainda estiver pendente (dois masters clicando
    // ao mesmo tempo não decidem duas vezes).
    const [decidida] = await sql`
      UPDATE solicitacoes_criacao_barbeiro
      SET status = ${novoStatus}, decidido_por = ${usuario.id}, decidido_em = now()
      WHERE id = ${caminho[1]} AND status = 'pendente'
      RETURNING solicitante_id
    `;
    if (!decidida) return erro(409, 'Este pedido já foi respondido.');
    if (novoStatus === 'aprovada') {
      await sql`
        UPDATE usuarios SET pode_criar_barbeiros = TRUE
        WHERE id = ${decidida.solicitante_id} AND papel = 'equipe' AND master = FALSE
      `;
    }
    return json(200, { ok: true, status: novoStatus });
  }

  // PUT /api/equipe/:id/permissao
  if (metodo === 'PUT' && ehId(caminho[0]) && caminho[1] === 'permissao') {
    const dados = corpoJson(event);
    if (!dados || typeof dados.podeCriarBarbeiros !== 'boolean') {
      return erro(400, 'Informe podeCriarBarbeiros (verdadeiro ou falso).');
    }
    const [alterado] = await sql`
      UPDATE usuarios SET pode_criar_barbeiros = ${dados.podeCriarBarbeiros}
      WHERE id = ${caminho[0]} AND papel = 'equipe' AND master = FALSE AND ativo = TRUE
      RETURNING id
    `;
    if (!alterado) return erro(404, 'Barbeiro comum não encontrado.');
    return json(200, { ok: true });
  }

  // PUT /api/equipe/:id/rebaixar (só a master raiz)
  if (metodo === 'PUT' && ehId(caminho[0]) && caminho[1] === 'rebaixar') {
    if (!usuario.master_raiz) return erro(403, 'Somente o master principal pode rebaixar outro master.');
    const [alterado] = await sql`
      UPDATE usuarios SET master = FALSE, pode_criar_barbeiros = FALSE
      WHERE id = ${caminho[0]} AND papel = 'equipe' AND master = TRUE AND master_raiz = FALSE AND ativo = TRUE
      RETURNING id
    `;
    if (!alterado) return erro(404, 'Master não encontrado (o master principal não pode ser rebaixado).');
    return json(200, { ok: true });
  }

  return metodoNaoPermitido(['GET', 'POST', 'PUT']);
});
