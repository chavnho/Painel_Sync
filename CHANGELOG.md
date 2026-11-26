# Changelog — Painel Sync MT5

## [v0.8.0] - 2026-11-26

### Adicionado
- **Construtor de Robôs Gerenciados pelo App (`src/db/tradesDb.ts`, `src/engine/robotEngine.ts`, `src/components/RobotBuilderView.tsx`)**:
  - Persistência em SQLite (`managed_robots`) com alocação automática de `MagicNumber` (9001+), trava de idempotência por candle (`last_signal_bar`) e bloqueio contra comandos duplicados (`hasActiveCommandForMagic`).
  - Motor matemático puro executado em candles fechados com 3 estratégias (**Cruzamento de Médias EMA/SMA**, **Reversão IFR/RSI** e **Rompimento de Canal**), **Regra de Disparo Personalizável** por gatilho (`onBullishSignal` e `onBearishSignal`: *Comprar*, *Vender* ou *Ignorar*), travas de janela operacional, stop diário e zeragem automática no fim do dia.
  - Normalização exata de preços e volumes pelo `tickSize`, `digits` e `volumeMin/Step/Max` da corretora/B3 (`resolveSymbolTickSpec`, `snapPriceToTick`, `snapVolumeToLot`).
- **Sincronização Multi-Ativo & Especificação de Tick no MT5 (`server.ts`, `src/utils/mt5Bridge.ts`, `Painel_Sync.mq5`)**:
  - Rotas REST CRUD `/api/mt5-sync/:channelId/managed-robots` e `/api/mt5-sync/:channelId/symbol-spec`.
  - Coleta paralela de candles de todos os ativos configurados nos robôs ativos via `watchSymbols` no Service MQL5 e envio de metadados de tick/lote em `SendSymbolsReport` e `SendCandlesData`.
- **Simulador de Backtest & Replay Vela a Vela (`src/engine/backtestSimulator.ts`, `src/components/BacktestReplayView.tsx`)**:
  - Aba **Simulador** no menu superior compartilhando o mesmo motor `evaluateManagedRobot`, com suporte a velas reais do MT5 ou amostra sintética offline.
  - Gráfico `lightweight-charts` v5 com médias móveis, marcadores de entrada/saída (`C`, `V`, `TP`, `SL`), linhas de posição aberta, modo **Maximizar (ESC)**, controles de Replay (**Play/Pause**, **+1 Vela**, **Zerar**, **100%**) com velocidades `0.5x`, `1x`, `3x` e `10x`, KPIs institucionais e tabela de operações simuladas.

## [v0.7.2] - 2026-11-25

### Corrigido & Melhorado
- **Conector MQL5 / Modo Service (`src/utils/mt5Bridge.ts` + `Painel_Sync.mq5`)**:
  - Adicionado par?metro `InpDefaultTimeframe` e tratamento de `PERIOD_CURRENT` (`_Period == 0`) para evitar que rob?s em modo Service reportem falsamente `M5`.
  - Substitu?do o parser de delimitaéo JSON em `FetchPendingRequest` por `FindJsonClosingDelim` com rastreamento de strings e escapes (`\"`), evitando quebra quando campos textuais cont?m `{`, `}`, `[` ou `]`.
  - Alinhado timeout de limpeza de ativo tempor?rio (`g_chartTempIdle >= 10`, 20s), removida diretiva obsoleta `#property strict` e substitu?da a regex de convers?o EA?Service por marcadores expl?citos (`EA_LIFECYCLE_START/END`).
- **Frontend & Visual (`EquityBaselineChart.tsx`, `LivePairingMonitor.tsx`, `TradingChartView.tsx`, `RobotSidebar.tsx`, `Mt5BridgeView.tsx`)**:
  - Corrigido deslocamento de 3h no gr?fico de equity ao alinhar o timestamp da sess?o ao fuso local da corretora.
  - Adicionados r?tulos e tipos para `source` (`backend`, `frontend`) e `outcome: 'request'` no monitor de pareamento.
  - Eliminado *stale closure* no polling de candles via `symbolRobotsRef`, limpos imports/divs duplicados na barra lateral e atualizados avisos de comandos remotos na tela de conex?o.
- **Backend, Seguran?a & Limpeza (`server.ts`, `package.json`, `.env.example`, `metadata.json`)**:
  - Adicionado TTL de 30s na `requestQueue`, validaéo obrigat?ria de token em `GET /pending`, suporte a `Authorization: Bearer` e *rate limiting* leve em `/commands` e `/request`.
  - Removidos arquivos e funées mortas (`queue.ts`, `bridge_commit.ts`, `processQueue`), corrigido `npm start` e `npm run clean` multiplataforma e limpos resqu?cios do AI Studio.

## [v0.7.0] - 2026-11-25

### Adicionado
- **Canal Bidirecional 1s & Fila Persistente de Comandos (`src/db/tradesDb.ts` + `server.ts` + `Painel_Sync.mq5`)**: Tabela `command_queue` em SQLite com TTL de 15s, endpoints `POST /commands` e `POST /commands/:id/ack`, evento SSE `command_update` e executor MQL5 a cada 1 segundo suportando `CLOSE_MAGIC`, `CANCEL_ORDERS`, `CLOSE_ALL` e `OPEN_ORDER` com log auditável de `retcode`.
- **Controles Operacionais na Barra Lateral (`src/components/RobotSidebar.tsx` + `src/App.tsx`)**: Botões **Zerar**, **Cancelar (N)** por robô/magic e **Zerar Tudo (Emergência)** no topo da carteira com confirmação em 2 cliques e feedback instantâneo do MetaTrader 5.
- **Subscrição Automática Temporária de Gráficos (`Painel_Sync.mq5` + `server.ts`)**: Ativação sob demanda de ativos fora da Observação do Mercado (`g_chartTempSym` com limpeza automática após 20s ocioso), sincronização de 500ms no Snapshot e Delta incremental de 50 velas sem lacunas.
- **Correção de Logs de Ordens e Posições (`Painel_Sync.mq5`)**: Uso de `ArrayFree` antes de `ArrayCopy` em `LogAccountStateChanges()` para evitar repetição de eventos quando o total de ordens ou posições chega a zero.
- **Modo Serviço MQL5 em 2º Plano (`src/utils/mt5Bridge.ts` + `src/components/ConnectView.tsx`)**: Seletor na aba *Conectar MT5* para gerar o coletor tanto como **Serviço (`MQL5\\Services\\`, `#property service`)** — rodando de forma independente sem precisar de gráfico aberto — quanto como **Expert Advisor (`MQL5\\Experts\\`)**.
- **Detecção Automática de Rolagem B3 D-1 (`Painel_Sync.mq5` + `server.ts` + `src/components/TradingChartView.tsx`)**: Identificação automática dos contratos vigentes (`WDO`, `WIN`, `IND`, `DOL`, `BIT`) via `SYMBOL_EXPIRATION_TIME` com margem de 1 dia útil antes do vencimento e redirecionamento automático de contratos vencidos no gráfico.
- **Logs Categorizados no Servidor e MQL5 (`server.ts` + `Painel_Sync.mq5`)**: Emissão automática de eventos de abertura/cancelamento de ordens e abertura/fechamento de posições com filtros por categoria (*Todos*, *Ordens*, *Posições*, *Conexão*, *Servidor*) e parâmetros organizados em grupos (`input group`) no MetaTrader 5.
- **Sistema Centralizado de Temas & Modal ao Vivo (`src/index.css` + `src/utils/themeTokens.ts` + `src/components/ThemeSettingsModal.tsx`)**: Variáveis CSS globais e modal interativo no cabeçalho com presets (*Institucional*, *Obsidiana OLED*, *Azul Ardósia*, *Grafite Suave*), seletores de cor em tempo real e escalas de fonte (*Compacta*, *Padrão*, *Ampliada*).

### Melhorado
- **Visão Geral & Curva de Resultado (`src/components/OverviewView.tsx` + `src/components/EquityBaselineChart.tsx`)**: *Histórico Consolidado* promovido para o topo da carteira, exibição do Drawdown Máximo histórico e percentual do capital, ponto inicial `R$ 0,00` e correção do parsing de datas do MT5 no hover sem recriar o gráfico a cada tick SSE.
- **Legibilidade das Tabelas & Relatórios (`src/components/TradesLedgerView.tsx` + `src/components/WeeklyMonthlyReportView.tsx` + `src/components/BuySellAnalyticsView.tsx`)**: Alternância sutil de linhas (zebra striping), badges discretos de `COMPRA`/`VENDA`, alinhamento da paleta `rose`/`emerald` e restauração completa de caracteres UTF-8.

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
- **Canal Bidirecional 1s & Fila Persistente de Comandos (`src/db/tradesDb.ts` + `server.ts` + `Painel_Sync.mq5`)**: Tabela `command_queue` em SQLite com TTL de 15s, endpoints `POST /commands` e `POST /commands/:id/ack`, evento SSE `command_update` e executor MQL5 a cada 1 segundo suportando `CLOSE_MAGIC`, `CANCEL_ORDERS`, `CLOSE_ALL` e `OPEN_ORDER` com log auditável de `retcode`.
- **Controles Operacionais na Barra Lateral (`src/components/RobotSidebar.tsx` + `src/App.tsx`)**: Botões **Zerar**, **Cancelar (N)** por robô/magic e **Zerar Tudo (Emergência)** no topo da carteira com confirmação em 2 cliques e feedback instantâneo do MetaTrader 5.
- **Subscrição Automática Temporária de Gráficos (`Painel_Sync.mq5` + `server.ts`)**: Ativação sob demanda de ativos fora da Observação do Mercado (`g_chartTempSym` com limpeza automática após 20s ocioso), sincronização de 500ms no Snapshot e Delta incremental de 50 velas sem lacunas.
- **Correção de Logs de Ordens e Posições (`Painel_Sync.mq5`)**: Uso de `ArrayFree` antes de `ArrayCopy` em `LogAccountStateChanges()` para evitar repetição de eventos quando o total de ordens ou posições chega a zero.
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
