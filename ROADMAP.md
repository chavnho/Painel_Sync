# Roadmap — Painel Sync MT5

## Concluído até v0.7.0
- [x] Telemetria multi-robô agrupada por `MagicNumber` (`Painel_Sync.mq5` + `server.ts` via SSE).
- [x] Gráficos em tela cheia com Snapshot + Delta incremental, série contínua vinculada, ordens pendentes e linhas de trade acima dos candles (`TradeLinesPrimitive`).
- [x] Persistência histórica em SQLite nativo (`data/painel_sync.db` via `node:sqlite`), backfill retroativo de 90 dias, preferências de robôs ocultos e backup automático `VACUUM INTO`.
- [x] Redesign institucional (`OverviewView` dividido em Pregão de Hoje vs Histórico Consolidado, `EquityBaselineChart` com `BaselineSeries` TradingView v5, `RobotSidebar` sincronizada e `RootErrorBoundary`).
- [x] Código MQL5 100% embutido e sincronizado em `src/utils/mt5Bridge.ts`, cópia com fallback garantido em HTTP local (`ConnectView.tsx`) e barra de filtros unificada em `WeeklyMonthlyReportView.tsx`.

## Próximas Etapas
1. **Unificação da Paleta Institucional (`#090D12` / `#0F141C`) nas Abas Restantes**:
   - Aplicar os tokens de superfície nas views restantes (`DashboardHeader`, `TradingChartView`, `BuySellAnalyticsView`, `OperationsView` e `IndependentChartView`).
2. **Atalhos de Teclado**:
   - Atalhos `1..6` para alternar entre abas e `Esc` para retornar à Carteira Ativa.
3. **Métricas Avançadas por Trade (MEP / MEN em Pontos)**:
   - Captura da Máxima Excursão Positiva (MFE) e Máxima Excursão Negativa (MAE) em pontos no EA (`Painel_Sync.mq5`) e exibição nas tabelas de operações.
4. **Comandos Operacionais Remotos via Fila `/pending`**:
   - Encerrar posição aberta (`CLOSE_MAGIC`) ou cancelar ordens pendentes (`CANCEL_ORDERS`) de um `MagicNumber` específico com confirmação dupla na UI.
