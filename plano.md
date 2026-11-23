# Plano de Evolução — Painel Sync MT5

## ✅ Concluído (v0.3.0)
1. **Sincronização de Conta e Robôs via Magic Number (`Painel_Sync.mq5` + `server.ts`)**:
   - Coletor único na conta varre posições abertas e negócios do dia agrupados automaticamente por `MagicNumber`.
   - Snapshot financeiro da conta (`balance`, `equity`, `margin`, `freeMargin`, `dailyPnlBrl`).
   - Log de pareamento inteligente baseado em assinatura de estado (evita spam a cada 2s).

2. **Catálogo de Ativos e Gráfico Mercado (`IndependentChartView.tsx`)**:
   - Filtro de ativos negociáveis e contratos futuros vigentes da B3 (ex: `WDOZ26`, `WINZ26`) enviados no `OnInit()`.
   - Cache dedicado no backend (`chartCandlesCache`) com flag `isChartRequest` para evitar criação de robôs fantasmas.

3. **Gráfico Automático por Robô (`TradingChartView.tsx`)**:
   - Carregamento automático de ativo e timeframe ao selecionar o robô na barra lateral.
   - Indicadores pré-definidos desativados por padrão e remoção do sub-painel inferior (`Volume / IFR / P&L`) para maximizar a área do gráfico.
   - Linhas horizontais dinâmicas de Entrada (com pontos e PnL R$ ao vivo), Stop Loss (SL), Take Profit (TP / OCO) e seta marcadora automática na vela de entrada.
   - Barra OHLC fixa no topo com o nome do robô alinhado à direita e `Live Event Feed` movido para a aba Conectar.

---

## 🚀 Próximas Etapas (v0.4.0)

### 1. Streaming Incremental de Candles (Snapshot + Delta de 2 Candles)
- **Objetivo**: Eliminar o reenvio de 120–150 candles a cada ciclo e atualizar a vela atual em tempo real com latência mínima.
- **Carga Inicial (Snapshot)**:
  - Quando `chartCandlesCache` estiver vazio para `symbol:timeframe`, o frontend dispara `POST /request` com `count: 150`.
  - O `Painel_Sync.mq5` executa `CopyRates(..., 0, 150)` uma única vez e popula o cache.
- **Atualização Contínua (Delta Incremental)**:
  - Enquanto o usuário estiver visualizando um gráfico, o frontend envia heartbeat de foco (`activeChart: { symbol, timeframe }`).
  - O `Painel_Sync.mq5` inclui apenas `CopyRates(..., 0, 2)` (vela atual em formação + vela anterior recém-fechada) no ciclo de 2s (~250 bytes).
  - O `server.ts` faz *upsert* por `time` no `chartCandlesCache` e o frontend aplica `candleSeries.update(lastCandle)` sem recarregar toda a série.
  - Expiração automática do foco após 15s sem heartbeat para economizar banda.

### 2. Persistência Histórica em Banco de Dados
- **Objetivo**: Armazenar histórico completo de trades e métricas semanais/mensais independentemente do histórico carregado no terminal MT5.
- **Implementação**:
  - Adicionar camada de banco local (SQLite via Prisma ou `better-sqlite3`) no `server.ts`.
  - Persistir cada `ExecutedTrade` deduplicado por `(accountLogin, dealTicket)`.
  - Alimentar as abas **Relatórios** e **Operações** diretamente do banco com filtros por data, robô e ativo.

### 3. Nomes Amigáveis por Magic Number
- Permitir mapear nomes personalizados no painel ou via input `InpMagicNamesMap` no EA (ex: `261001=EaZonas;261002=RoboScalper`).
