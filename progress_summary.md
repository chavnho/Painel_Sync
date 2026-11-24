# Resumo de Progresso — Painel Sync MT5 (v0.3.5)

## Entregas Concluídas
- [x] **Bridge Bidirecional MT5 <-> Node (`Painel_Sync.mq5` + `server.ts`)**: Telemetria em tempo real via SSE (`EventSource`), fila `/pending` sob demanda e suporte a *heartbeat* sem robôs ativos na abertura do mercado.
- [x] **Gráficos em Tela Cheia (`TradingChartView.tsx` + `IndependentChartView.tsx`)**: Snapshot + Delta incremental de 2 candles, vínculo de série contínua (`WIN$N`/`WDO$N`) com contrato vigente, linhas de Posição, SL, TP e Ordens Pendentes com cálculo ao vivo de pontos e R$.
- [x] **Identificação por MagicNumber (`App.tsx` + `RobotSidebar.tsx`)**: Nomes amigáveis editáveis inline e tags de cor clicáveis por `MagicNumber` persistidos em `localStorage`, propagados para todo o painel.
- [x] **Diagnóstico e Conta MT5 (`ConnectView.tsx` + `DashboardHeader.tsx`)**: Exibição de Servidor, Tipo (`REAL`/`DEMO`), Modo (`HEDGE`/`NETTING`), Conta e Margem Disponível, horário local no Log de Pareamento e acesso direto à configuração do EA no cabeçalho.
- [x] **Relatórios e Operações (`WeeklyMonthlyReportView.tsx` + `TradesLedgerView.tsx`)**: Filtro por robô selecionado corrigido na tabela consolidada e histórico de execuções com exportação CSV.

## Próximos Passos
- [ ] **Persistência Histórica em SQLite (`node:sqlite`)**: Criar tabela `executed_trades` deduplicada por `(account_login, deal_ticket)` em `data/painel_sync.db`.
- [ ] **Sincronização de Histórico**: Carregar automaticamente trades históricos do SQLite ao iniciar o servidor e mesclar com a telemetria ao vivo.