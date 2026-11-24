# Roadmap — Painel Sync MT5

## v0.4.0 (Próximas Entregas)

### 1. Persistência Histórica em SQLite (`node:sqlite`)
- Criar módulo `src/db/tradesDb.ts` utilizando `DatabaseSync` nativo do Node v26 (`data/painel_sync.db`).
- Persistir `ExecutedTrade` deduplicado por `(account_login, deal_ticket)`.
- Hidratar automaticamente `historyTrades` ao iniciar o servidor para manter relatórios semanais/mensais e histórico de operações entre reinicializações.

### 2. Propagação de Cores e Controles Operacionais
- Propagar as cores configuradas por `MagicNumber` na barra lateral para os gráficos e relatórios consolidados.
- Avaliar comandos operacionais remotos via fila `/pending` (ex.: pausar ou zerar robô específico).