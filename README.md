# 21 / Contra a Mesa

Jogo web fictício de 21 com créditos virtuais, campanha Standard/Hardcore, modo online contra a mesa, salas multiplayer, bots, rankings e chat.

## Arquitetura

```text
GitHub Pages / navegador
        |
        v
Node.js + Express + Socket.IO (Render)
        |
        v
Supabase / PostgreSQL
```

O navegador nunca recebe `SUPABASE_SERVICE_ROLE_KEY` nem `AUTH_SECRET`. O backend é a autoridade para cartas, apostas, saldo, resultados, empréstimos, ranking, histórico e sessões online.

## Estrutura

```text
index.html
style.css
script.js
betting-ui.js
realtime-rooms.js
supabase-config.js
server.js
backend/game-core.js
backend/schema.sql
render.yaml
```

## Rodar localmente

1. Instale Node.js 20+.
2. Execute `npm install`.
3. Configure as variáveis de ambiente:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
AUTH_SECRET=uma-chave-grande-e-secreta
CLIENT_ORIGIN=http://localhost:3000
```

4. No Supabase, execute `backend/schema.sql`.
5. Execute:

```bash
npm start
```

6. Abra `http://localhost:3000`.

Sem Supabase, o servidor entra em modo de desenvolvimento local em memória para facilitar testes da interface, mas a persistência real exige Supabase.

## GitHub Pages + Render

No GitHub Pages, ajuste `supabase-config.js`:

```js
window.MULTIPLAYER_URL = 'https://SEU-SERVICO.onrender.com';
```

No Render, configure:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AUTH_SECRET
CLIENT_ORIGIN=https://SEU-USUARIO.github.io
```

O serviço já possui `render.yaml` com health check em `/api/health`.

## Regras de empate

1. Se só um jogador estourar, o outro vence.
2. Se os dois estourarem, é empate.
3. Se só um tiver pontuação válida, ele vence.
4. Entre pontuações válidas diferentes, a maior vence.
5. Mesma pontuação abaixo de 21 = empate.
6. Se ambos fizerem 21: menos cartas -> maior rank (`K > Q > J > 10 > ... > A`) -> naipe (`♠ > ♥ > ♦ > ♣`) -> empate.

## Modos de sala

- Normal
- Survival: até 10 rodadas
- Rodadas ganhas: primeiro a atingir o alvo definido pelo Host

## Testes

```bash
npm test
```

O ambiente que gerou este pacote não possui as dependências npm instaladas, então o teste de integração real com Express/Socket.IO/Supabase precisa ser executado depois do `npm install` em um ambiente com rede/registro npm disponível.
