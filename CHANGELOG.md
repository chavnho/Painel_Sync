# Changelog — Painel Sync MT5

## [v0.6.0] - 2026-11-24

### Adicionado
- **Redesign Institucional da Carteira (`src/components/OverviewView.tsx` + `src/components/EquityBaselineChart.tsx`)**: Separação clara entre *Pregão de Hoje* (Resultado com flutuante, Drawdown Hoje, curva `BaselineSeries` do TradingView v5 e tabela enxuta do dia) e *Histórico Consolidado* (Saldo Acumulado, Média por Trade e barra proporcional Gain vs Loss).
- **Proteção Global de Renderização (`src/main.tsx`)**: Instalação do `RootErrorBoundary` com captura e exibição de stack trace.

### Melhorado
- **Sidebar Sincronizada (`src/components/RobotSidebar.tsx`)**: Exibição alinhada aos robôs visíveis (`Carteira Ativa (N)`), cards minimalistas em 2 linhas e badges `BUY` / `SELL` / `FLAT`.
- **EA MQL5 Autocontido no Código-Fonte (`src/utils/mt5Bridge.ts` + `src/components/ConnectView.tsx` + `src/components/Mt5BridgeView.tsx`)**: Template completo do `Painel_Sync.mq5` embutido diretamente no TypeScript com injeção automática de `Endpoint`, `Channel ID` e `Auth Token`, sem depender de arquivo `.mq5` externo.
- **Barra de Filtros Alinhada (`src/components/PeriodFilterBar.tsx` + `src/components/WeeklyMonthlyReportView.tsx`)**: Remoção de botões redundantes de período rápido, cabeçalho em linha única na aba *Relatórios* e padronização visual (`#090D12` / `#0F141C`).

### Corrigido
- **Botão de Cópia do Código do EA (`src/components/ConnectView.tsx`)**: Adicionado fallback `document.execCommand('copy')` para ambientes HTTP/rede local sem HTTPS e restauração de encoding UTF-8.

## - 2026-11-24

### Adicionado
- **Persistência de Robôs Ocultos no SQLite**: tabela `robot_preferences` em `data/painel_sync.db`, injeção automática do estado `hidden` no snapshot e rota `PATCH /api/mt5-sync/:channelId/robots/:magicNumber` com atualização imediata via SSE.
- **Controle Compacto na Sidebar**: botão de ocultar/exibir em cada card de robô e filtro em linha única `Robôs (N)` + `Ocultos (N) / Ocultar` na `RobotSidebar`.

### Corrigido
- **Blindagem de Gráficos em Contratos Vencidos**: tratamento seguro para robôs históricos sem candles ativos ou com séries vazias/vencidas (ex.: `WDOQ26`) no `TradingChartView`, evitando quebra de renderização e exibindo status claro de `Sem cotação`.

## [v0.5.1] - 2026-11-24
### Adicionado
- **Filtros de Período Unificados (src/components/PeriodFilterBar.tsx)**: Seletores de Ano, Janeiro..Dezembro e calendários De / Até replicados nas abas *Compras & Vendas* e *Relatórios*, alinhados com a aba *Operações*.
- **Alerta Visual de Atraso MT5 (src/components/DashboardHeader.tsx)**: Indicador âmbar automático no cabeçalho quando o servidor passa de 10 segundos sem receber pacote de telemetria do MetaTrader 5.
- **Backup Seguro do SQLite (src/db/tradesDb.ts + server.ts)**: Rotina automática via VACUUM INTO a cada 6 horas (e endpoint manual POST /api/db/backup) mantendo os 7 snapshots mais recentes em data/backups/.

### Melhorado
- **Histórico Consolidado e Apelidos (src/App.tsx + src/components/BuySellAnalyticsView.tsx)**: Propagação de nomes personalizados (magicAliases) também nos historyTrades vindos do SQLite e leitura completa do histórico consolidado na análise de Compras & Vendas.
- **Template do EA Sincronizado (src/utils/mt5Bridge.ts)**: O botão de download na aba *Conectar MT5* passa a gerar o painel_sync.mq5 completo já preenchido com InpEndpointUrl e InpSyncToken da sessão ativa.

## [v0.5.0] - 2026-11-24
### Adicionado
- **Importação Histórica Retroativa & Parciais (Painel_Sync.mq5 + server.ts + src/db/tradesDb.ts)**: Backfill automático de 90 dias no OnInit() em lotes de 15 dias, cálculo de preço médio ponderado de entrada por DEAL_POSITION_ID e reconstituição de robôs inativos e contratos vencidos da B3.
- **Linhas de Trade no Gráfico (src/utils/tradeLinesPrimitive.ts)**: Primitiva ISeriesPrimitive (zOrder: 'top') desenhando entradas e saídas tracejadas com a cor do robô acima dos candles.

## - 2026-11-24
### Adicionado
- **Persistência Histórica em SQLite (`src/db/tradesDb.ts` + `server.ts`)**: Armazenamento local em `data/painel_sync.db` utilizando `node:sqlite` (`DatabaseSync` em modo WAL), deduplicado por `(account_login, deal_ticket)`, com hidratação automática de `historyTrades` entre reinicializações do servidor.
- **Design Tokens & Tema Centralizado (`src/index.css` + `src/utils/themeTokens.ts`)**: Variáveis globais `@theme` no Tailwind v4, paleta `ROBOT_COLORS` compartilhada e formatadores semânticos (`getPnlTextClass`, `getSideTextClass`).
- **Propagação de Cores por MagicNumber**: Cor determinística por `MagicNumber` (customizável com um clique na barra lateral) sincronizada em tempo real nos Gráficos, Livro de Operações, Análise de Compras & Vendas e Relatórios.

### Melhorado
- **Análise de Compras & Vendas (`BuySellAnalyticsView.tsx`)**: Neutralização visual de valores zerados (`R$ 0,00`), alinhamento numérico à direita nas tabelas e badge do robô selecionado no cabeçalho.
- **Barra Lateral, Cabeçalho e Aba Conectar**: Cards destacados com borda lateral colorida, botão direto para Configuração EA no cabeçalho e horário local no Log de Pareamento.

## - 2026-11-24
### Adicionado
- Nomes amigáveis editáveis por `MagicNumber` na barra lateral propagados para todo o painel.
- Ordens pendentes (`BUY/SELL LIMIT` e `STOP`) e rótulos financeiros ao vivo (`pts` e `R$`) nos gráficos.
- Streaming incremental de candles (Snapshot + Delta de 2 velas) e autocomplete de ativos B3 por teclado.
- Exibição de Servidor, Tipo (`REAL`/`DEMO`), Modo (`HEDGE`/`NETTING`) e Margem Disponível.
