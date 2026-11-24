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

## ✅ Concluído (v0.4.0-alpha)
1. **Streaming Incremental de Candles (Snapshot + Delta de 2 Candles)**:
   - Carga inicial (Snapshot) com histórico estendido (`CopyRates`) sem poluir a Observação do Mercado do MT5 (`SymbolSelect` temporário com restauração automática).
   - Atualização contínua em tempo real via foco ativo (`activeChart`, expira em 15s) enviando apenas Delta incremental de 2 velas (`isChartDelta: true`, ~250 bytes) e *upsert* por `time` no `server.ts`.
   - Padronização visual da aba **Mercado** (`IndependentChartView.tsx`) em tela cheia (100% largura e altura), sem sub-painel inferior, indicadores desligados por padrão e barra OHLC dinâmica no hover.
   - Navegação por teclado (`↑` / `↓` + `Enter`) com destaque visual e scroll automático no seletor de ativos (`SymbolAutocomplete.tsx`).

---

## 🚀 Próximas Etapas (v0.4.0)

### 1. Persistência Histórica em Banco de Dados (SQLite)
- **Objetivo**: Armazenar histórico completo de trades e métricas semanais/mensais independentemente do histórico carregado no terminal MT5.
- **Implementação**:
  - Adicionar camada de banco local (SQLite via `better-sqlite3` ou Prisma) no `server.ts`.
  - Persistir cada `ExecutedTrade` deduplicado por `(accountLogin, dealTicket)`.
  - Alimentar as abas **Relatórios** e **Operações** diretamente do banco com filtros por data, robô e ativo.

### 2. Nomes Amigáveis por Magic Number
- Permitir mapear e editar nomes personalizados diretamente no painel (salvos no banco) ou via input `InpMagicNamesMap` no EA (ex: `261001=EaZonas;261002=RoboScalper`), refletindo nos gráficos, relatórios e logs.
