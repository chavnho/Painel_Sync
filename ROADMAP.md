# Roadmap — Painel Sync MT5

## Concluído até v0.5.1
- [x] Telemetria multi-robô agrupada por `MagicNumber` (`Painel_Sync.mq5` + `server.ts` via SSE).
- [x] Gráficos em tela cheia com Snapshot + Delta incremental, série contínua vinculada, ordens pendentes e linhas de trade acima dos candles (`TradeLinesPrimitive`).
- [x] Design Tokens centralizados (`src/index.css` + `src/utils/themeTokens.ts`) e propagação de cores e apelidos por `MagicNumber` em todas as abas.
- [x] Persistência histórica em SQLite nativo (`data/painel_sync.db` via `node:sqlite`), backfill retroativo de 90 dias, suporte a saídas parciais e backup automático `VACUUM INTO`.
- [x] Filtros unificados de período (`Ano`, `Janeiro..Dezembro` e calendários `De / Até`) em *Operações*, *Compras & Vendas* e *Relatórios*.
- [x] Monitoramento de latência/atraso de conexão MT5 (`> 10s`) no cabeçalho e geração sincronizada do template `painel_sync.mq5` na aba *Conectar MT5*.

## Próximas Etapas (v0.5.2+)
1. **Comandos Operacionais Remotos via Fila `/pending` (em avaliação)**:
   - Enviar comandos do painel para o EA encerrar posição aberta (`CLOSE_MAGIC`) ou cancelar ordens pendentes (`CANCEL_ORDERS`) de um `MagicNumber` específico, com confirmação dupla na UI e TTL de 15 segundos.
