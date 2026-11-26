# Roadmap — Painel Sync MT5

## Concluído até v0.8.0
- [x] Telemetria multi-robô agrupada por `MagicNumber` (`Painel_Sync.mq5` + `server.ts` via SSE).
- [x] Execução flexível no MetaTrader 5 como **Serviço em 2º Plano (`#property service`)** ou **Expert Advisor**, com inputs organizados em grupos e logs categorizados.
- [x] Detecção automática de contratos vigentes B3 com rolagem D-1 útil via `SYMBOL_EXPIRATION_TIME` e redirecionamento automático no gráfico.
- [x] Gráficos em tela cheia com Snapshot + Delta incremental, série contínua vinculada, ordens pendentes e linhas de trade acima dos candles (`TradeLinesPrimitive`).
- [x] Persistência histórica em SQLite nativo (`data/painel_sync.db` via `node:sqlite`), backfill retroativo de 90 dias, preferências de robôs ocultos e backup automático `VACUUM INTO`.
- [x] Redesign institucional (*Histórico Consolidado* no topo, *Pregão de Hoje*, Drawdown Máximo histórico/diário, `EquityBaselineChart` estabilizado e tabelas com zebra striping).
- [x] Sistema centralizado de temas (`src/index.css` + `UI_THEME`) com modal ao vivo (*Institucional*, *Obsidiana OLED*, *Azul Ardósia*, *Grafite Suave*).
- [x] **Canal Bidirecional & Comandos Operacionais Remotos**: Fila persistente SQLite (`command_queue`) com TTL de 15s e recibos (`ACK`) em tempo real via SSE (`CLOSE_MAGIC`, `CANCEL_ORDERS`, `CLOSE_ALL`, `OPEN_ORDER`).
- [x] **Construtor de Robôs Gerenciados pelo App**: Tabela `managed_robots` com `MagicNumber` 9001+, motor puro em candles fechados (`robotEngine.ts`), 3 estratégias (Cruzamento EMA/SMA, Reversão IFR, Rompimento de Canal), **Regra de Disparo Personalizável** por gatilho (*Comprar*, *Vender* ou *Ignorar*), normalização de tick/lote da corretora e sincronização paralela `watchSymbols` no MQL5.
- [x] **Simulador de Backtest & Replay Vela a Vela**: Motor de simulação compartilhado (`backtestSimulator.ts`), carregamento de velas reais do MT5 ou amostra offline, marcadores de entrada/saída, linhas de posição aberta, modo Maximizar (ESC) e velocidades `0.5x`, `1x`, `3x` e `10x`.

## Próximos Passos (v0.9.0+)
- [ ] **Curva de Capital no Simulador & Overlays no Gráfico Principal**: Exibir curva de equity abaixo dos candles no Simulador e plotar médias dos robôs ativos diretamente no `TradingChartView.tsx`.
- [ ] **Novas Estratégias & Gestão Avançada**: Bandas de Bollinger, MACD, Break-Even automático e Trailing Stop.
- [ ] **MEP / MEN em Pontos**: Capturar Máxima Excursão Positiva (MFE) e Máxima Excursão Negativa (MAE) por operação no MQL5 e exibir nas tabelas e relatórios.
