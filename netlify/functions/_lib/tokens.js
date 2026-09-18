/**
 * Geração/hash de tokens de uso único (confirmação de e-mail, recuperação
 * de senha) — mesmo princípio já usado em sessao.js para o cookie de
 * sessão: o token em si (grande, aleatório) só existe no e-mail enviado à
 * pessoa; o banco guarda só o hash dele. Extraído para cá em vez de
 * duplicado, já que agora três lugares diferentes precisam da mesma lógica
 * (verificação de e-mail, recuperação de senha, e o próprio sessao.js
 * segue com a sua cópia local — não mexemos em código que já funciona).
 */
const crypto = require('crypto');

function gerarTokenBruto() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(tokenBruto) {
  return crypto.createHash('sha256').update(tokenBruto).digest('hex');
}

module.exports = { gerarTokenBruto, hashToken };
