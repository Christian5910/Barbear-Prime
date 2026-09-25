/**
 * POST /api/auth/esqueci-senha
 * Body: { email }
 *
 * Sempre responde com a MESMA mensagem genérica, exista ou não conta com
 * esse e-mail — do contrário, esse endpoint vira uma forma fácil de
 * descobrir quais e-mails têm cadastro no site (manda um e-mail qualquer
 * e vê se a resposta muda).
 *
 * Funciona mesmo se a conta ainda não tiver confirmado o e-mail original
 * (ver auth-resetar-senha.js: completar a redefinição com um token válido
 * já prova que a pessoa tem acesso à caixa de entrada, então de brinde já
 * marca a conta como verificada também).
 */
const { getSql } = require('./_lib/db');
const { json, erro, metodoNaoPermitido, corpoJson, comProtecao } = require('./_lib/http');
const { gerarTokenBruto, hashToken } = require('./_lib/tokens');
const { enviarEmailRecuperacaoSenha } = require('./_lib/email');

const VALIDADE_TOKEN_HORAS = 1;
const JANELA_MINUTOS = 15;
const MAX_PEDIDOS_NA_JANELA = 3;
// Piso de tempo de resposta — ver comentário em processarPedido() abaixo.
const ATRASO_MINIMO_MS = 600;
const MENSAGEM_GENERICA =
  'Se este e-mail tiver uma conta, enviamos um link de redefinição de senha para ele.';

/**
 * Faz todo o trabalho de verdade (buscar a conta, checar rate limit,
 * gravar o token, mandar o e-mail) sem nunca devolver nada que dependa de
 * qual ramo rodou — quem chama sempre recebe a mesma mensagem genérica,
 * então o valor de retorno daqui nem importa.
 */
async function processarPedido(sql, email, event) {
  const [usuario] = await sql`
    SELECT id, nome, email FROM usuarios WHERE email = ${email} AND ativo = TRUE LIMIT 1
  `;
  if (!usuario) return;

  const [{ total: pedidosRecentes }] = await sql`
    SELECT COUNT(*)::int AS total FROM recuperacoes_senha
    WHERE usuario_id = ${usuario.id} AND criado_em > now() - make_interval(mins => ${JANELA_MINUTOS})
  `;
  if (pedidosRecentes >= MAX_PEDIDOS_NA_JANELA) return;

  const tokenBruto = gerarTokenBruto();
  const tokenHash = hashToken(tokenBruto);
  const expiraEm = new Date(Date.now() + VALIDADE_TOKEN_HORAS * 3600 * 1000);
  await sql`
    INSERT INTO recuperacoes_senha (usuario_id, token_hash, expira_em)
    VALUES (${usuario.id}, ${tokenHash}, ${expiraEm.toISOString()})
  `;

  try {
    await enviarEmailRecuperacaoSenha(event, usuario.email, usuario.nome, tokenBruto);
  } catch (e) {
    console.error('Falha ao enviar e-mail de recuperação de senha:', e.message);
  }
}

exports.handler = comProtecao(async (event) => {
  if (event.httpMethod !== 'POST') return metodoNaoPermitido(['POST']);

  const dados = corpoJson(event);
  const email = String(dados?.email || '').trim().toLowerCase();
  if (!email) return erro(400, 'Informe o e-mail.');

  const sql = getSql();

  // IMPORTANTE (contra ataque de tempo): a mensagem devolvida é sempre a
  // mesma genérica, exista ou não a conta — de propósito, pra não dar
  // como descobrir quais e-mails têm cadastro. Só que, sem isso aqui,
  // ainda daria pra descobrir de outro jeito: quando o e-mail existe,
  // este endpoint faz consultas extras no banco e ainda manda um e-mail
  // de verdade (uma chamada de rede pra fora, pro Resend) antes de
  // responder — sempre mais lento que o caso "e-mail não existe", que
  // responde quase na hora. Um atacante cronometrando a resposta
  // conseguiria distinguir os dois casos mesmo com o texto idêntico.
  // Medir o tempo gasto e completar até um piso fixo (independente de
  // qual ramo rodou) fecha essa diferença.
  const inicio = Date.now();
  try {
    await processarPedido(sql, email, event);
  } catch (e) {
    console.error('Erro ao processar pedido de recuperação de senha:', e.message);
  }
  const decorrido = Date.now() - inicio;
  if (decorrido < ATRASO_MINIMO_MS) {
    await new Promise((resolve) => setTimeout(resolve, ATRASO_MINIMO_MS - decorrido));
  }

  return json(200, { ok: true, mensagem: MENSAGEM_GENERICA });
});
