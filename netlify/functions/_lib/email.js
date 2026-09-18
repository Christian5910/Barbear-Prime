/**
 * Envio de e-mail transacional (confirmação de cadastro e recuperação de
 * senha) via Resend (https://resend.com) — API HTTP simples, sem SMTP e
 * sem precisar de um pacote novo no projeto (mesmo padrão já usado com o
 * ImageKit em upload.js: chamada direta com `fetch`).
 *
 * Variáveis de ambiente necessárias (ver DEPLOY.md):
 *   RESEND_API_KEY   — chave da conta Resend (começa com "re_")
 *   RESEND_FROM      — remetente, ex.: "Barbear Prime <naoresponda@seudominio.com>"
 *                       PRECISA ser um endereço no domínio que você verificou
 *                       no Resend — sem isso, só é possível mandar e-mail
 *                       pra você mesmo (o dono da conta Resend), não pra
 *                       clientes de verdade. Ver DEPLOY.md, passo do Resend.
 *   SITE_URL         — URL pública do site (ex.: "https://barbearprime.netlify.app"),
 *                       usada para montar o link clicável dentro do e-mail.
 *                       Sem "/" no final.
 */

function envFaltando(nome) {
  return new Error(
    `${nome} não configurada. Veja o passo do Resend em DEPLOY.md na raiz do projeto.`
  );
}

/**
 * MODO LOCAL — enquanto RESEND_API_KEY (ou RESEND_FROM) não estiver
 * configurada, nenhum e-mail de verdade é enviado. Em vez disso, o
 * conteúdo (com o link de verificação/redefinição) é escrito nos logs da
 * function — acessível em Netlify → seu site → Functions → (nome da
 * function) → Function log, ou direto no terminal quando rodando
 * `netlify dev`. Pegue o link de lá pra testar o fluxo na mão.
 *
 * Isso é o que deixa dar pra desenvolver e testar cadastro/recuperação de
 * senha sem precisar de domínio nem de conta no Resend ainda — mas o link
 * NUNCA volta na resposta HTTP (só nos logs, que só o dono do site
 * consegue ver): mesmo em modo local, o projeto já fica publicado num
 * endereço público (*.netlify.app), então devolver o token na resposta
 * daria pra qualquer visitante confirmar/redefinir a conta de qualquer
 * outra pessoa sem precisar do e-mail de verdade — a diferença entre
 * "modo de desenvolvimento" e "brecha de segurança" é só essa.
 *
 * Assim que RESEND_API_KEY e RESEND_FROM forem configuradas (depois de
 * verificar um domínio de verdade no Resend — ver DEPLOY.md), o envio real
 * liga sozinho, sem precisar mexer em nenhum arquivo.
 */
function emModoLocal() {
  return !process.env.RESEND_API_KEY || !process.env.RESEND_FROM;
}

async function enviarEmail({ para, assunto, html, texto }) {
  if (emModoLocal()) {
    console.log('\n========== E-MAIL (MODO LOCAL — Resend não configurado) ==========');
    console.log(`Para: ${para}`);
    console.log(`Assunto: ${assunto}`);
    console.log('');
    console.log(texto);
    console.log('====================================================================\n');
    return { modoLocal: true };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.RESEND_FROM;

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: remetente,
      to: [para],
      subject: assunto,
      html,
      text: texto,
    }),
  });

  const resultado = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(resultado?.message || 'Falha ao enviar o e-mail agora.');
  }
  return resultado;
}

function urlSite(event) {
  const configurado = process.env.SITE_URL;
  if (configurado) return configurado.replace(/\/$/, '');
  // Sem SITE_URL configurada: deduz a partir de quem chamou a API (o
  // próprio domínio *.netlify.app do site, por exemplo) — assim não
  // precisa configurar nada antes do primeiro teste. Configure SITE_URL
  // mais tarde (ex.: ao trocar para um domínio próprio) para fixar o
  // valor em vez de depender do cabeçalho da requisição.
  const host = event?.headers?.['x-forwarded-host'] || event?.headers?.host;
  if (host) return `https://${host}`;
  throw envFaltando('SITE_URL');
}

// Wrapper de HTML simples e consistente pros dois e-mails abaixo — mesma
// identidade visual em ambos, sem depender de nenhum serviço de template.
function envelope({ titulo, corpoHtml, textoBotao, linkBotao }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#111;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#1c1c1c;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#c9a227;padding:20px 24px;">
                <span style="color:#111;font-size:18px;font-weight:bold;">Barbear Prime</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#e6e6e6;font-size:15px;line-height:1.5;">
                <h1 style="color:#fff;font-size:20px;margin:0 0 16px;">${titulo}</h1>
                ${corpoHtml}
                <div style="text-align:center;margin:28px 0;">
                  <a href="${linkBotao}" style="background:#c9a227;color:#111;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:8px;display:inline-block;">${textoBotao}</a>
                </div>
                <p style="color:#999;font-size:12px;word-break:break-all;">Se o botão não funcionar, copie e cole este link no navegador:<br>${linkBotao}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function enviarEmailVerificacao(event, para, nome, tokenBruto) {
  const link = `${urlSite(event)}/sites/verificar-email.html?token=${tokenBruto}`;
  const html = envelope({
    titulo: `Olá, ${nome}!`,
    corpoHtml: `<p>Falta só um passo para ativar sua conta no Barbear Prime: confirme que este e-mail é seu clicando no botão abaixo. O link expira em 24 horas.</p>`,
    textoBotao: 'Confirmar meu e-mail',
    linkBotao: link,
  });
  const texto = `Olá, ${nome}! Confirme seu e-mail no Barbear Prime acessando: ${link} (expira em 24 horas)`;
  return enviarEmail({ para, assunto: 'Confirme seu e-mail — Barbear Prime', html, texto });
}

async function enviarEmailRecuperacaoSenha(event, para, nome, tokenBruto) {
  const link = `${urlSite(event)}/sites/redefinir-senha.html?token=${tokenBruto}`;
  const html = envelope({
    titulo: `Redefinir senha`,
    corpoHtml: `<p>Olá, ${nome}. Pediram a redefinição da senha desta conta no Barbear Prime. Se foi você, clique no botão abaixo para escolher uma senha nova — o link expira em 1 hora.</p><p>Se você não pediu isso, pode ignorar este e-mail: sua senha continua a mesma.</p>`,
    textoBotao: 'Criar nova senha',
    linkBotao: link,
  });
  const texto = `Olá, ${nome}. Redefina sua senha no Barbear Prime acessando: ${link} (expira em 1 hora). Se não foi você, ignore este e-mail.`;
  return enviarEmail({ para, assunto: 'Redefinição de senha — Barbear Prime', html, texto });
}

module.exports = {
  enviarEmailVerificacao,
  enviarEmailRecuperacaoSenha,
};
