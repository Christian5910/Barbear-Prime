# Barbear Prime — Sistema de Autenticação e Banco de Dados Local

> **Nota de atualização:** o arquivo `database/db.js` agora é um cliente
> HTTP para um backend real (Netlify Functions + PostgreSQL/Neon) — ver
> `DEPLOY.md` na raiz do projeto. Esta documentação descreve a versão
> 100% local (sem servidor), preservada em `database/db.local.js` para
> quem quiser rodar o site como demo offline, sem backend nenhum. Para
> usar essa versão local, troque a referência de `database/db.js` para
> `database/db.local.js` nos arquivos HTML de `sites/`.

## Visão Geral

Este sistema foi desenvolvido para funcionar **inteiramente no navegador**, utilizando `localStorage` como banco de dados local. Ele oferece autenticação completa (cadastro, login, logout, exclusão de conta), diferenciação entre usuários comuns e administradores (equipe), agendamento de serviços, preferências de corte, upload de avatar e persistência de dados, tudo sem necessidade de servidor backend.

---

## Por que usar localStorage?

- **Simplicidade**: não requer instalação de banco de dados nem configuração de servidor.
- **Portabilidade**: funciona em qualquer navegador moderno, sem dependências externas.
- **Ideal para protótipos e MVPs**: permite testar fluxos completos de autenticação e agendamento.
- **Dados persistentes**: mesmo fechando e reabrindo o navegador, os dados permanecem (a menos que o usuário limpe o localStorage).

---

## Estrutura de Dados no localStorage

O sistema simula um banco de dados relacional usando chaves no `localStorage`:

| Chave | Descrição | Estrutura |
|-------|-----------|-----------|
| `bp_usuarios` | Lista de usuários cadastrados | `[{ id, nome, email, senhaHash, papel, avatar, criadoEm, ativo }]` |
| `bp_sessao` | Dados da sessão atual | `{ usuarioId, papel, nome, email, avatar, logadoEm }` |
| `bp_agendamentos` | Lista de agendamentos | `[{ id, usuarioId, usuarioNome, servicoIds, data, hora, status, criadoEm }]` |
| `bp_preferencias_corte` | Preferências de corte por usuário | `{ usuarioId: { tamanho_cabelo, tipo_degrade, acabamento, estilo_barba, notas } }` |
| `bp_config` | Configurações gerais (reservado) | `{}` |

Para mais detalhes sobre cada campo, consulte o arquivo [`estrutura-local.md`](./estrutura-local.md).

---

## Como Usar

### 1. Cadastro de Usuário
- Acesse `cadastro.html`.
- Preencha nome, e-mail e senha (mínimo 6 caracteres).
- Ao enviar, o usuário é salvo no `localStorage` com o papel `cliente` (padrão).
- Após o cadastro, você é redirecionado para a página de login.

### 2. Login
- Acesse `login.html` (clientes) ou `login-equipe.html` (administradores).
- Insira e-mail e senha cadastrados.
- Se as credenciais estiverem corretas, você será redirecionado:
  - Cliente → `index.html`
  - Equipe → `painel-barbeiro.html`

### 3. Perfil do Usuário
- Após logado, acesse `perfil.html`.
- Veja seus dados (nome, e-mail, avatar) e seu próximo agendamento.
- Clique no ícone de engrenagem para editar (`editar-perfil.html`).

### 4. Editar Perfil
- Em `editar-perfil.html`, você pode:
  - Alterar nome, e-mail e senha.
  - Trocar a foto de avatar (upload de imagem, convertida para base64 e salva).
- As alterações são salvas no `localStorage` e a sessão é atualizada.

### 5. Agendamento de Serviços
- Em `servicos.html`, selecione um ou mais serviços clicando em "Agendar Serviço".
- Clique em "Continuar" para ir para `agendamento.html`.
- Escolha uma data e horário disponíveis.
- Confirme o agendamento — ele será salvo no `localStorage` e você será redirecionado para `meus-agendamentos.html`.

### 6. Gerenciar Agendamentos
- Em `meus-agendamentos.html`, veja seus agendamentos futuros e passados.
- É possível cancelar um agendamento (altera o status para `cancelado`).

### 7. Excluir Conta
- No perfil (`perfil.html`), há um botão "Excluir Conta".
- Ao clicar, uma confirmação é solicitada.
- Se confirmado, o usuário, seus agendamentos e preferências são removidos permanentemente do `localStorage`.

### 8. Preferências de Corte
- Em `preferencias-corte.html`, você pode definir suas preferências de corte (tamanho, degradê, acabamento, estilo de barba e notas adicionais).
- As preferências são salvas por usuário e carregadas automaticamente na próxima visita.

### 9. Tema Escuro/Claro e Tamanho da Fonte
- Em `preferencias-app.html`, altere o tema (claro/escuro) e o tamanho da fonte.
- As preferências são salvas em `sessionStorage` e aplicadas imediatamente.

---

## Como Testar com Dados de Exemplo

O sistema já inclui um usuário de exemplo para testes:

- **Cliente**: `joao@yahoo.com` / `123456`
- **Equipe**: `equipe@barbearprime.com` / `admin123` (se você criar um usuário com papel `equipe`)

Para criar um usuário administrador, durante o cadastro você pode modificar o script para definir `papel = 'equipe'`. No código atual, o cadastro padrão é sempre `cliente`. Para criar um admin, você pode inserir manualmente no localStorage ou ajustar a função `cadastrarUsuario` no `ui.js`.

### Populando com dados iniciais

Execute o arquivo [`seed.js`](./seed.js) no console do navegador para criar automaticamente usuários, agendamentos e preferências de exemplo. Basta copiar o conteúdo do arquivo e colar no console (F12 → Console).

---

## Casos de Uso Comuns e Exemplos de Código

### Criar um novo usuário via código
```javascript
cadastrarUsuario('Ana Silva', 'ana@email.com', 'minhaSenha123', 'cliente');
```

### Fazer login
```javascript
const usuario = login('ana@email.com', 'minhaSenha123');
if (usuario) {
  console.log('Logado com sucesso!');
}
```

### Salvar um agendamento
```javascript
salvarAgendamentoLocal(['1', '3'], '2026-09-15', '14:00');
```

### Excluir conta do usuário atual
```javascript
excluirConta();
```

### Carregar preferências de corte de um usuário
```javascript
const prefs = getPreferenciasCorte(usuarioId);
console.log(prefs.tamanho_cabelo); // 'médio', 'curto', etc.
```

---

## Confusões Frequentes e Como Resolver

### 1. "Meus dados sumiram após fechar o navegador"
- **Causa**: O localStorage é persistente, mas se você estiver usando modo de navegação anônima ou tiver limpado os dados do site, eles serão perdidos.
- **Solução**: Certifique-se de que não está em modo anônimo e que não limpou o localStorage acidentalmente.

### 2. "Não consigo fazer login mesmo com e-mail e senha corretos"
- **Causa**: A senha é codificada em Base64 no localStorage. Se você modificou manualmente o banco, a senha pode não corresponder.
- **Solução**: Use o cadastro para criar um novo usuário ou verifique se a senha está sendo codificada corretamente (`btoa(senha)`).

### 3. "O upload de avatar não funciona"
- **Causa**: O arquivo pode ser muito grande (limite de 2MB) ou o navegador pode estar bloqueando o acesso ao arquivo.
- **Solução**: Use imagens menores que 2MB e verifique as permissões do navegador.

### 4. "O agendamento não salva"
- **Causa**: O usuário pode não estar logado. O sistema verifica a sessão antes de salvar.
- **Solução**: Certifique-se de que o usuário está logado e que a sessão não expirou.

### 5. "O botão 'Excluir Conta' não aparece"
- **Causa**: O botão só aparece em `perfil.html` e requer que o usuário esteja logado.
- **Solução**: Faça login e verifique se o elemento `<button id="btnExcluirConta">` existe no HTML.

### 6. "Como diferenciar cliente de equipe?"
- **Causa**: O campo `papel` no usuário define isso. Clientes têm `papel = 'cliente'` e equipe tem `papel = 'equipe'`. O login redireciona para páginas diferentes baseado nisso.
- **Solução**: Para criar um usuário equipe, você pode ajustar o cadastro para definir o papel manualmente (ex: `papel = 'equipe'`) ou criar um usuário diretamente no localStorage.

### 7. "Preferências de corte não são carregadas"
- **Causa**: As preferências são salvas por `usuarioId`. Se o usuário mudar, as preferências não serão transferidas.
- **Solução**: Cada usuário tem suas próprias preferências. Se você criar um novo usuário, ele começará com preferências vazias.

---

## Arquivos Reutilizáveis e Manutenção

### `ui.js` (assets/src/ui.js)
Este arquivo contém todas as funções de interação com a interface. Ele chama as funções do banco de dados (agora separadas em `database/db.js`). As principais funções de UI são:
- `mostrarToast`
- `iniciarSelecaoServicos`
- `iniciarAgendamentoDinamico`
- `iniciarGruposPreferencia`
- `iniciarCalendarioMock`
- `iniciarSeletorTema`
- `iniciarSliderFonte`
- `iniciarPreviewAvatar`
- `iniciarAbasAgendamentos`
- `iniciarAgendaBarbeiro`
- `iniciarMenuHamburguer`
- `iniciarValidacaoFormularios`
- `iniciarAncorasInternas`

### `db.js` (database/db.js)
Contém toda a lógica de persistência:
- Autenticação: `getUsuarios`, `salvarUsuarios`, `cadastrarUsuario`, `login`, `logout`, `excluirConta`, `atualizarPerfil`
- Agendamento: `getAgendamentos`, `salvarAgendamentoLocal`, `cancelarAgendamentoLocal`, `getAgendamentosDoUsuario`
- Preferências: `salvarPreferenciasCorte`, `getPreferenciasCorte`
- Sessão: `getSessao`, `salvarSessao`, `encerrarSessao`, `usuarioLogado`

### Como estender o sistema
- **Novos campos no perfil**: Adicione novos atributos ao objeto `usuario` no `db.js` e atualize as funções `cadastrarUsuario`, `atualizarPerfil` e `carregarDadosPerfil` no `ui.js`.
- **Novos tipos de agendamento**: Modifique a estrutura de `agendamentos` no `db.js` e as funções de salvamento.
- **Integração com backend**: Substitua as funções de `localStorage` por chamadas à API (ex: `fetch`), mantendo a mesma interface.

---

## Limitações e Considerações de Segurança

- **Senhas em Base64**: Não use este sistema em produção sem criptografia adequada (bcrypt, argon2). Aqui, a codificação Base64 é apenas para evitar texto puro.
- **Dados locais**: O localStorage é acessível a qualquer script na página. Não armazene dados sensíveis.
- **Sem proteção contra XSS**: Como os dados são salvos no navegador, qualquer script malicioso na página pode acessá-los. Em produção, use headers de segurança adequados.

---

## Conclusão

Este sistema oferece uma base sólida para prototipagem de aplicações com autenticação, agendamento e preferências de usuário, tudo funcionando localmente. Ele é ideal para demonstrações, testes de usabilidade e desenvolvimento inicial, podendo ser facilmente adaptado para um backend real quando necessário.