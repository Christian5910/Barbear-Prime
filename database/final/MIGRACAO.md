# Migração: de `database/db.js` (localStorage) para banco real

Este documento mapeia cada função do protótipo (`database/db.js`) para a
tabela/consulta SQL equivalente. Migrar o front-end significa, na prática,
trocar o corpo de cada função de `db.js` por uma chamada `fetch()` a uma API
que executa a consulta correspondente — os nomes das funções e o que elas
retornam podem continuar iguais, para não precisar reescrever `assets/src/ui.js`.

## Convenção de nomes

| localStorage (JS, camelCase) | Banco (SQL, snake_case)          |
|-------------------------------|-----------------------------------|
| `usuario.id`                   | `usuarios.id`                    |
| `usuario.senhaHash`            | `usuarios.senha_hash`            |
| `usuario.criadoEm`             | `usuarios.criado_em`             |
| `agendamento.usuarioId`        | `agendamentos.usuario_id`        |
| `agendamento.servicoIds`       | tabela `agendamento_servicos`    |
| `agendamento.servicosSnapshot` | colunas `nome_snapshot` / `preco_centavos_snapshot` em `agendamento_servicos` |
| `agendamento.horariosOcupados` | tabela `agendamento_horarios`    |
| `agendamento.barbeiroId`       | `agendamentos.barbeiro_id`       |
| preço em reais (float)         | preço em **centavos** (inteiro) — evita erro de arredondamento de float |

## Tabela de funções

### Usuários e sessão

| Função em `db.js`         | Tabela(s)                  | Observação |
|----------------------------|------------------------------|------------|
| `getUsuarios()`             | `SELECT * FROM usuarios`    | Nunca devolver `senha_hash` para o front-end |
| `getBarbeiros()`            | `SELECT * FROM usuarios WHERE papel='equipe' AND ativo=1` | |
| `cadastrarUsuario()`        | `INSERT INTO usuarios`      | Gerar hash de senha real (bcrypt/argon2), não Base64 |
| `login()`                   | `SELECT ... WHERE email=?`  | Comparar com `password_verify()`/bcrypt.compare(), não string |
| `salvarSessao()`            | `INSERT INTO sessoes`       | Usar token aleatório + `expira_em`, não guardar a sessão inteira no cliente |
| `atualizarPerfil()`         | `UPDATE usuarios`           | |
| `excluirConta()`            | `DELETE FROM usuarios` (cascata cuida do resto) | |

### Serviços

| Função em `db.js`         | Tabela(s)             | Observação |
|----------------------------|------------------------|------------|
| `getServicos()`             | `SELECT * FROM servicos WHERE ativo=1 ORDER BY nome` | |
| `criarServico()`            | `INSERT INTO servicos`| |
| `atualizarServico()`        | `UPDATE servicos`     | **Nunca** propaga para `agendamento_servicos` — o snapshot já gravado permanece intacto |
| `excluirServico()`          | `UPDATE servicos SET ativo=0` (soft delete recomendado) | Preserva a referência para agendamentos antigos |
| `getServicosDestaque()`     | `SELECT * FROM servicos WHERE destaque=1 LIMIT 4` | |

### Agendamentos (a parte mais importante)

| Função em `db.js`              | Tabela(s)                                  | Observação |
|----------------------------------|----------------------------------------------|------------|
| `getHorariosDisponiveis(data, servicoIds, barbeiroId)` | `SELECT hora FROM agendamento_horarios ah JOIN agendamentos a ON a.id=ah.agendamento_id WHERE a.data_servico=? AND a.status<>'cancelado' AND (?=NULL OR a.barbeiro_id=?)` | Depois, calcular sequências livres em código (mesma lógica de `slotsNecessarios`/`sequenciaDeHorarios`) |
| `slotsNecessarios(servicoIds)`   | `SELECT SUM(duracao_min) FROM servicos WHERE id IN (?)` → `CEIL(soma / 60)` | |
| `salvarAgendamentoLocal()`       | `INSERT INTO agendamentos` + `INSERT INTO agendamento_horarios` (1 linha por slot) + `INSERT INTO agendamento_servicos` (com snapshot) | Fazer tudo numa transação |
| `criarAgendamentoEquipe()`       | igual acima, com `usuario_id=NULL`, `cliente_nome` preenchido, `barbeiro_id` = usuário logado | |
| `remarcarAgendamentoLocal()`     | `UPDATE agendamentos` (nova data/hora/status) + regravar `agendamento_horarios` + regravar snapshot em `agendamento_servicos` com o preço **atual** do serviço | Esta é a regra "remarcação atualiza o preço" |
| `cancelarAgendamentoLocal()`     | `UPDATE agendamentos SET status='cancelado'` | |
| `getAgendamentosDoUsuario()`     | `SELECT * FROM agendamentos WHERE usuario_id=? ORDER BY data_servico, hora_inicio` | |
| `calcularTotalAgendamento()`     | `SELECT SUM(preco_centavos_snapshot) FROM agendamento_servicos WHERE agendamento_id=?` | Sempre usa o snapshot, nunca o preço atual do catálogo |

### Preferências e configuração

| Função em `db.js`               | Tabela(s)                     |
|-----------------------------------|----------------------------------|
| `getPreferenciasCorte()`           | `SELECT * FROM preferencias_corte WHERE usuario_id=?` |
| `salvarPreferenciasCorte()`        | `INSERT ... ON DUPLICATE KEY UPDATE` |
| `getBannerBarbearia()`             | `SELECT valor FROM config_app WHERE chave='banner_barbearia_url'` |
| `getPreferenciaNotificacoes()`     | `SELECT notif_agendamentos FROM preferencias_notificacao WHERE usuario_id=?` |
| `getSomNotificacao()` / `getSomPersonalizado()` | mesma tabela `preferencias_notificacao` |

## O que muda de comportamento

- **Preço em centavos, não reais**: o protótipo usa float (`20`, `45.5`);
  o schema usa inteiro em centavos (`2000`, `4550`) para evitar erro de
  arredondamento. Divida por 100 ao exibir.
- **Senha com hash real**: o protótipo usa só Base64 (`hashSenha()` em
  `db.js`), que **não é segurança nenhuma** — é só para não guardar a senha
  em texto puro no localStorage de um protótipo local. Antes de qualquer
  uso real, toda autenticação deve ser refeita no servidor com bcrypt ou
  argon2, e a comparação de senha nunca deve acontecer no navegador.
- **Confirmação de exclusão de conta**: o protótipo usa `window.confirm()`
  (só existe no navegador) — num backend real, a confirmação vira uma
  segunda etapa da API (ex.: exigir a senha de novo), não uma função de
  navegador.
