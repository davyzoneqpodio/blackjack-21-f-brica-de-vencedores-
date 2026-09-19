# Revisão da implementação

## Implementado

- Autenticação server-side com `scrypt` + token HMAC.
- Persistência Supabase para conta, histórico, ranking, chats e metadados de salas.
- Sessões online controladas pelo servidor.
- Saque idempotente via RPC `settle_online_session`.
- Sala pública/privada, 1–6 jogadores, Host, bots e saldo inicial definido pelo Host.
- Modos Normal, Survival e Rodadas ganhas.
- Chat global e chat de sala.
- Regras centrais do 21 em `backend/game-core.js`.
- Desempate especial de 21 e empate verdadeiro.
- Campanha Standard e Hardcore com os nomes especificados.
- Desafios sem aposta sem UI de aposta e sem empréstimo.
- Easter eggs e Tom conforme a especificação.
- Menu de dicas completo.

## Limitação de verificação

Foi possível executar verificações de sintaxe e testes unitários do núcleo sem instalar dependências npm. A integração real com Express, Socket.IO e Supabase requer `npm install` e credenciais/serviços válidos.
