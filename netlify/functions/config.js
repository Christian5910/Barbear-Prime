/**
 * /api/config
 *   GET — devolve a configuração pública (banner, endereço, preferências de exibição)
 *   PUT — atualiza uma chave de configuração (requer sessão de equipe)
 *         Body: { chave: 'banner_barbearia_url', valor: '...' }
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson } = require('./_lib/http');
const { getUsuarioDaSessao } = require('./_lib/sessao');

const CHAVES_PERMITIDAS = [
  'banner_barbearia_url',
  'banner_barbearia_ajuste',   // 'cortar' | 'original' — escolha feita no upload do banner
  'endereco_linha1',
  'endereco_linha2',
  'endereco_cep',
  'endereco_numero',
  'endereco_mapa_busca',       // termo de busca usado no mapa (iframe, sem precisar de chave de API)
  'localizacao_info_blocos',   // JSON: [{ id, icone, texto }] — horário, telefone, redes sociais etc., lista editável
  'servicos_destaque_vazio',   // 'true' quando o barbeiro escolheu deliberadamente não destacar nenhum serviço
];

// 'localizacao_info_blocos' e 'banner_barbearia_url' guardam URLs de imagem
// (ícone de cada bloco / banner) que a página PÚBLICA de Localização e a
// Home renderizam num `<img src="...">`. Como só a equipe pode gravar
// config (checado abaixo), o risco aqui é bem menor que o do avatar do
// cliente — mas ainda assim é "confiar cegamente" numa string vinda direto
// do corpo da requisição, e essas páginas são vistas por QUALQUER visitante
// do site, logado ou não. Validamos/normalizamos com o mesmo princípio do
// avatar em usuarios.js: exigir uma URL http(s) bem formada neutraliza
// aspas/`<`/`>` (sempre percent-encoded pelo parser de URL), fechando a
// possibilidade de uma conta de equipe comprometida injetar HTML/JS que
// rodaria no navegador de todo mundo que visitasse a página.
function normalizarUrlImagem(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const url = new URL(String(valor)); // deixa lançar — chamador decide o erro 400
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL inválida (use http:// ou https://).');
  }
  return url.href;
}

function validarValorDaChave(chave, valor) {
  if (chave === 'banner_barbearia_url') {
    return normalizarUrlImagem(valor);
  }
  if (chave === 'localizacao_info_blocos') {
    let blocos;
    try {
      blocos = valor ? JSON.parse(valor) : [];
    } catch (e) {
      throw new Error('localizacao_info_blocos precisa ser um JSON válido.');
    }
    if (!Array.isArray(blocos)) throw new Error('localizacao_info_blocos precisa ser uma lista.');
    const normalizados = blocos.map(b => ({
      ...b,
      icone: b?.icone ? normalizarUrlImagem(b.icone) : (b?.icone ?? null),
    }));
    return JSON.stringify(normalizados);
  }
  return valor;
}

exports.handler = async (event) => {
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
};
