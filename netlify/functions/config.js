/**
 * /api/config
 *   GET — devolve a configuração pública (banner, endereço, preferências de exibição)
 *   PUT — atualiza uma chave de configuração (requer sessão de equipe)
 *         Body: { chave: 'banner_barbearia_url', valor: '...' }
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJsonLimitado: corpoJson, comProtecao } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');
const { normalizarUrlImagem } = require('./_lib/urls');

const CHAVES_PERMITIDAS = [
  'banner_barbearia_url',
  'banner_barbearia_ajuste',   // 'proporcao' | 'recorte' | 'tamanho-original' | 'padrao' — como a capa é exibida
  'home_faixa_valores',        // JSON: [{ titulo, texto }] — os 3 destaques logo abaixo da capa da Home
  'endereco_linha1',
  'endereco_linha2',
  'endereco_cep',
  'endereco_numero',
  'endereco_mapa_busca',       // termo de busca usado no mapa (iframe, sem precisar de chave de API)
  'localizacao_info_blocos',   // JSON: [{ id, icone, texto }] — horário, telefone, redes sociais etc., lista editável
  'servicos_destaque_vazio',   // 'true' quando o barbeiro escolheu deliberadamente não destacar nenhum serviço
];

// Todo valor gravado aqui é lido por QUALQUER visitante do site (a Home e a
// Localização são públicas) e várias partes viram HTML. Por isso cada chave
// tem um formato próprio, conferido campo a campo: só os campos esperados
// entram no banco, com tamanho limitado, e as URLs de imagem só podem apontar
// para o ImageKit ou para /assets/ (ver _lib/urls.js). Assim uma conta master
// comprometida (ou alguém chamando a API direto) não injeta HTML/JS nem
// entope o banco com textos gigantes.
const AJUSTES_BANNER = ['proporcao', 'recorte', 'tamanho-original', 'padrao'];
const MAX_TEXTO_CURTO = 200;

function textoLimpo(valor, max, rotulo) {
  const t = String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (t.length > max) throw new Error(`${rotulo} muito longo (máximo ${max} caracteres).`);
  return t;
}

function lerJsonLista(valor, rotulo, maxItens) {
  let lista;
  try {
    lista = valor ? JSON.parse(valor) : [];
  } catch (e) {
    throw new Error(`${rotulo} precisa ser um JSON válido.`);
  }
  if (!Array.isArray(lista)) throw new Error(`${rotulo} precisa ser uma lista.`);
  if (lista.length > maxItens) throw new Error(`${rotulo} aceita no máximo ${maxItens} itens.`);
  return lista;
}

function validarValorDaChave(chave, valor) {
  if (chave === 'banner_barbearia_url') {
    return normalizarUrlImagem(valor, 'imagem de capa');
  }
  if (chave === 'banner_barbearia_ajuste') {
    if (!AJUSTES_BANNER.includes(valor)) throw new Error(`Ajuste inválido. Use: ${AJUSTES_BANNER.join(', ')}.`);
    return valor;
  }
  if (chave === 'servicos_destaque_vazio') {
    if (valor !== 'true' && valor !== 'false') throw new Error('Valor inválido.');
    return valor;
  }
  if (chave === 'localizacao_info_blocos') {
    const blocos = lerJsonLista(valor, 'localizacao_info_blocos', 12);
    const normalizados = blocos.map((b) => {
      if (!b || typeof b !== 'object') throw new Error('Bloco de informação inválido.');
      const iconeBootstrap = b.iconeBootstrap ? String(b.iconeBootstrap) : 'bi-info-circle';
      // vira classe CSS no HTML: só o padrão dos ícones do Bootstrap
      if (!/^bi-[a-z0-9-]{1,40}$/.test(iconeBootstrap)) throw new Error('Ícone inválido.');
      return {
        id: b.id ? textoLimpo(b.id, 40, 'Id do bloco').replace(/[^a-zA-Z0-9_-]/g, '') : undefined,
        texto: textoLimpo(b.texto, MAX_TEXTO_CURTO, 'Texto do bloco'),
        icone: b.icone ? normalizarUrlImagem(b.icone, 'ícone') : null,
        iconeBootstrap,
        formato: b.formato === 'circulo' ? 'circulo' : 'quadrado',
      };
    });
    return JSON.stringify(normalizados);
  }
  if (chave === 'home_faixa_valores') {
    const itens = lerJsonLista(valor, 'home_faixa_valores', 3);
    return JSON.stringify(itens.map((i) => {
      if (!i || typeof i !== 'object') throw new Error('Item de destaque inválido.');
      const titulo = textoLimpo(i.titulo, 40, 'Título');
      const texto = textoLimpo(i.texto, 90, 'Descrição');
      if (!titulo) throw new Error('Cada destaque precisa de um título.');
      return { titulo, texto };
    }));
  }
  // endereco_*: texto simples com teto
  return textoLimpo(valor, chave === 'endereco_mapa_busca' ? 300 : MAX_TEXTO_CURTO, 'Valor');
}

exports.handler = comProtecao(async (event) => {
  const sql = getSql();

  if (event.httpMethod === 'GET') {
    const linhas = await sql`SELECT chave, valor FROM config_app`;
    const config = Object.fromEntries(linhas.map(l => [l.chave, l.valor]));
    return json(200, { config });
  }

  if (event.httpMethod === 'PUT') {
    const usuario = await getUsuarioDaSessao(event);
    // Endereço, banner e blocos de informação da Localização são
    // configuração da barbearia inteira — só o barbeiro MASTER edita,
    // não qualquer conta de equipe (mesma regra de servicos.js).
    if (!usuario || usuario.papel !== 'equipe' || !usuario.master) {
      return erro(403, 'Apenas o barbeiro master pode alterar a configuração.');
    }

    const dados = corpoJson(event);
    if (!dados || !CHAVES_PERMITIDAS.includes(dados.chave)) {
      return erro(400, `Chave inválida. Use uma de: ${CHAVES_PERMITIDAS.join(', ')}.`);
    }

    let valor;
    try {
      valor = validarValorDaChave(dados.chave, dados.valor);
    } catch (e) {
      return erro(400, e.message);
    }

    await sql`
      INSERT INTO config_app (chave, valor) VALUES (${dados.chave}, ${valor})
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
    `;
    return json(200, { ok: true });
  }

  return metodoNaoPermitido(['GET', 'PUT']);
});
