# Roadmap — Painel Sync MT5

## Conclu?do at? v0.7.2
- [x] Telemetria multi-robô agrupada por `MagicNumber` (`Painel_Sync.mq5` + `server.ts` via SSE).
- [x] Execução flexível no MetaTrader 5 como **Serviço em 2º Plano (`#property service`)** ou **Expert Advisor**, com inputs organizados em grupos e logs categorizados.
- [x] Detecção automática de contratos vigentes B3 com rolagem D-1 útil via `SYMBOL_EXPIRATION_TIME` e redirecionamento automático no gráfico.
- [x] Gráficos em tela cheia com Snapshot + Delta incremental, série contínua vinculada, ordens pendentes e linhas de trade acima dos candles (`TradeLinesPrimitive`).
- [x] Persistência histórica em SQLite nativo (`data/painel_sync.db` via `node:sqlite`), backfill retroativo de 90 dias, preferências de robôs ocultos e backup automático `VACUUM INTO`.
- [x] Redesign institucional (*Histórico Consolidado* no topo, *Pregão de Hoje*, Drawdown Máximo histórico/diário, `EquityBaselineChart` estabilizado e tabelas com zebra striping).
- [x] Sistema centralizado de temas (`src/index.css` + `UI_THEME`) com modal ao vivo (*Institucional*, *Obsidiana OLED*, *Azul Ardósia*, *Grafite Suave*).

- [x] **Canal Bidirecional & Comandos Operacionais Remotos**: Fila persistente SQLite (`command_queue`) com TTL de 15s e recibos (`ACK`) em tempo real via SSE (`CLOSE_MAGIC`, `CANCEL_ORDERS`, `CLOSE_ALL`, `OPEN_ORDER`), controles **Zerar**, **Cancelar (N)** e **Zerar Tudo** na sidebar com confirmação dupla, subscrição automática temporária de ativos no gráfico (`g_chartTempSym`) e logs limpos sem repetição (`ArrayFree`).

## Próximos Passos (v0.8.0+)
- [ ] **MEP / MEN em Pontos**: Capturar Máxima Excursão Positiva (MFE) e Máxima Excursão Negativa (MAE) por operação no MQL5 e exibir nas tabelas e relatórios.

