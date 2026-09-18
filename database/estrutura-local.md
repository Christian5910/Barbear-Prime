# Estrutura do Banco de Dados Local (localStorage)

O sistema Barbear Prime utiliza `localStorage` para a persistência de dados no navegador. Esta documentação detalha as chaves utilizadas, o formato das estruturas armazenadas e os métodos recomendados para manipulação dos dados via script.

---

## Chaves do Storage

O sistema utiliza o prefixo `bp_` para evitar conflito com outras aplicações no mesmo domínio:

- **`bp_usuarios`**: Lista de usuários cadastrados no sistema.
- **`bp_sessao`**: Objeto com as informações do usuário ativo no momento.
- **`bp_agendamentos`**: Lista de todos os agendamentos registrados.
- **`bp_preferencias_corte`**: Dicionário de preferências de corte indexado pelo ID do usuário.
- **`bp_config`**: Configurações gerais da aplicação (tema, preferências globais).

---

## Detalhamento das Estruturas JSON

### 1. `bp_usuarios`
Armazena a lista de usuários registrados no sistema.

**Chaves e Campos:**
- `id` *(Number)*: Identificador único gerado via timestamp/randômico.
- `nome` *(String)*: Nome completo do usuário.
- `email` *(String)*: E-mail de acesso (usado como identificador de login).
- `senhaHash` *(String)*: Senha codificada em Base64 (apenas para simulação de hash).
- `papel` *(String)*: Nível de permissão do usuário (`cliente` ou `equipe`).
- `avatar` *(String)*: URL relativa ou string Base64 da imagem de perfil.
- `criadoEm` *(String)*: Data/hora de criação no formato ISO 8601.
- `ativo` *(Boolean)*: Status da conta (`true` para ativa, `false` para desativada).

```json
[
  {
    "id": 1001,
    "nome": "João Osvaldo",
    "email": "joao@yahoo.com",
    "senhaHash": "MTIzNDU2",
    "papel": "cliente",
    "avatar": "assets/img/avatar-exemplo.jpg",
    "criadoEm": "2026-08-31T12:00:00.000Z",
    "ativo": true
  }
]
```

---

### 2. `bp_sessao`
Contém as informações necessárias para manter a autenticação do usuário durante a navegação.

**Chaves e Campos:**
- `usuarioId` *(Number)*: ID de referência ao usuário em `bp_usuarios`.
- `papel` *(String)*: Perfil do usuário logado (`cliente` ou `equipe`).
- `nome` *(String)*: Nome de exibição do usuário.
- `email` *(String)*: E-mail do usuário logado.
- `avatar` *(String)*: Imagem de exibição rápida na interface.
- `logadoEm` *(String)*: Timestamp do último login em formato ISO 8601.

```json
{
  "usuarioId": 1001,
  "papel": "cliente",
  "nome": "João Osvaldo",
  "email": "joao@yahoo.com",
  "avatar": "assets/img/avatar-exemplo.jpg",
  "logadoEm": "2026-08-31T12:05:00.000Z"
}
```

---

### 3. `bp_agendamentos`
Lista de horários reservados pelos clientes.

**Chaves e Campos:**
- `id` *(Number)*: Identificador único do agendamento.
- `usuarioId` *(Number)*: ID do cliente que efetuou a reserva.
- `usuarioNome` *(String)*: Nome do cliente para exibição rápida na interface do barbeiro.
- `servicoIds` *(Array[String])*: Lista com os IDs dos serviços selecionados.
- `data` *(String)*: Data da reserva no formato `YYYY-MM-DD`.
- `hora` *(String)*: Horário agendado no formato `HH:MM`.
- `status` *(String)*: Estado do agendamento (`pendente`, `confirmado` ou `cancelado`).
- `criadoEm` *(String)*: Timestamp da criação da reserva.

```json
[
  {
    "id": 2001,
    "usuarioId": 1001,
    "usuarioNome": "João Osvaldo",
    "servicoIds": ["1", "3"],
    "data": "2026-09-15",
    "hora": "14:00",
    "status": "confirmado",
    "criadoEm": "2026-08-31T12:10:00.000Z"
  }
]
```

---

### 4. `bp_preferencias_corte`
Objeto indexado pelo `usuarioId` com os detalhes personalizados sobre a preferência visual de cada cliente.

**Chaves e Campos (por ID de Usuário):**
- `tamanho_cabelo` *(String)*: Estilo do comprimento (`curto`, `medio`, `longo`).
- `tipo_degrade` *(String)*: Tipo do acabamento do degradê (`baixo`, `medio`, `alto`, `navalhado`, `sombreado`).
- `acabamento` *(String)*: Linha de contorno/pezinho (`quadrado`, `arredondado`, `natural`).
- `estilo_barba` *(String)*: Preferência para a barba (`feita_rasa`, `desenhada`, `longa_cheia`, `sem_barba`).
- `notas` *(String)*: Observações de preferência em texto livre.

```json
{
  "1001": {
    "tamanho_cabelo": "medio",
    "tipo_degrade": "navalhado",
    "acabamento": "arredondado",
    "estilo_barba": "longa_cheia",
    "notas": "Prefiro a nuca bem alinhada e o contorno da barba mais fechado."
  }
}
```

---

## Operações Principais (CRUD via `db.js`)

As manipulações dessas estruturas no `localStorage` devem ser feitas utilizando a API global `window.db`:

* **Ler usuários:** `window.db.getUsuarios()`
* **Obter usuário logado:** `window.db.getSessao()`
* **Cadastrar novo usuário:** `window.db.cadastrarUsuario(nome, email, senha, papel)`
* **Realizar Login:** `window.db.login(email, senha)`
* **Criar agendamento:** `window.db.salvarAgendamentoLocal(servicoIds, data, hora)`
* **Atualizar preferências:** `window.db.salvarPreferenciasCorte(usuarioId, objetoPreferencias)`

---

## Considerações e Limitações

- **Persistência Volátil:** Os dados salvos através do `localStorage` ficam restritos ao navegador e dispositivo em uso.
- **Limite de Armazenamento:** A capacidade máxima padrão varia entre **5MB e 10MB** por domínio.
- **Segurança:** O `localStorage` armazena dados em texto puro acessíveis via JavaScript. Não armazene senhas reais ou dados sensíveis de pagamento sem criptografia forte de servidor.