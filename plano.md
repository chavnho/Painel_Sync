# Plano de Evolução — Painel Sync MT5

## Concluído (v0.3.0)
1. **Sincronização de Conta e Robôs via Magic Number (`Painel_Sync.mq5` + `server.ts`)**:
   - Coletor único na conta varre posições abertas, ordens pendentes e negócios do dia agrupados automaticamente por `MagicNumber`.
   - Snapshot financeiro da conta (`balance`, `equity`, `margin`, `freeMargin`, `dailyPnlBrl`, `marginMode`).
   - Log de pareamento inteligente baseado em assinatura de estado (evita spam a cada 2s).

2. **Catálogo de Ativos e Gráfico Mercado (`IndependentChartView.tsx`)**:
   - Filtro de ativos negociáveis e contratos futuros vigentes da B3 (ex: `WDOZ26`, `WINZ26`) enviados no `OnInit()`.
   - Cache dedicado no backend (`chartCandlesCache`) com flag `isChartRequest` para evitar criação de robôs fantasmas.

3. **Gráfico Automático por Robô (`TradingChartView.tsx`)**:
   - Carregamento automático de ativo e timeframe ao selecionar o robô na barra lateral.
   - Indicadores pré-definidos desativados por padrão e remoção do sub-painel inferior (`Volume / IFR / P&L`) para maximizar a área do gráfico.
   - Linhas horizontais dinâmicas de Entrada (com pontos e PnL R$ ao vivo), Stop Loss (SL), Take Profit (TP / OCO) e seta marcadora automática na vela de entrada.
   - Barra OHLC fixa no topo com o nome do robô alinhado à direita.

---

## Concluído (v0.3.5)
1. **Streaming Incremental de Candles (Snapshot + Delta de 2 Candles)**:
   - Carga inicial (Snapshot) com histórico estendido (`CopyRates`) sem poluir a Observação do Mercado do MT5 (`SymbolSelect` temporário com restauração automática).
   - Atualização contínua em tempo real via foco ativo (`activeChart`, expira em 15s) enviando apenas Delta incremental de 2 velas (`isChartDelta: true`) e *upsert* por `time` no `server.ts`.
   - Padronização visual da aba **Mercado** (`IndependentChartView.tsx`) e da aba **Gráficos** (`TradingChartView.tsx`) em tela cheia (100% largura e altura), barra OHLC dinâmica no hover e navegação por teclado (`↑` / `↓` + `Enter`) no seletor de ativos (`SymbolAutocomplete.tsx`).
   - Vínculo automático entre série contínua (`WIN$N`, `WDO$N`) e contrato vigente (`WINZ26`, `WDOZ26`) no gráfico para exibição de posições abertas e ordens pendentes.

2. **Ordens Pendentes e Rótulos Financeiros no Gráfico (`Painel_Sync.mq5` + `TradingChartView.tsx`)**:
   - Varredura de ordens apregoadas no book (`OrdersTotal()`) agrupadas por `ORDER_MAGIC` (`BUY LIMIT`, `SELL LIMIT`, `BUY STOP`, `SELL STOP`).
   - Renderização de linhas horizontais pontilhadas de espessura 2 com rótulos escuros de alto contraste para Ordem, `SL` e `TP`, com cálculo automático de pontos e resultado financeiro (`R$`) ao vivo.

3. **Nomes Amigáveis, Tags de Cor e Refinamentos de UI (`App.tsx`, `RobotSidebar.tsx`, `ConnectView.tsx`, `DashboardHeader.tsx`)**:
   - Edição inline de nomes amigáveis por `MagicNumber` na barra lateral (persistidos em `localStorage` e propagados para gráficos, relatórios e histórico de operações).
   - Tag de cor clicável por `MagicNumber` e cards destacados na barra lateral, exibindo **Margem Disponível** no rodapé.
   - Aba **Conectar** unificada com card **Conta MT5** (Servidor, Tipo `REAL`/`DEMO`, Modo `HEDGE`/`NETTING`, Conta e Margem Disponível), horário local no Log de Pareamento e botão **Limpar Sessão**.
   - Aceitação de *heartbeat* sem robôs ativos (`robots: []`) no `server.ts` com `HTTP 200`, eliminando falsos erros na abertura do pregão.

---

## Próximas Etapas (v0.4.0)

### 1. Persistência Histórica em Banco de Dados (`node:sqlite`)
- **Objetivo**: Armazenar histórico completo de trades e métricas semanais/mensais independentemente do histórico carregado no terminal MT5 ou reinicializações do servidor.
- **Implementação**:
  - Utilizar o módulo nativo `node:sqlite` (`DatabaseSync`, disponível no Node v26) no `server.ts` com arquivo local `data/painel_sync.db`.
  - Persistir cada `ExecutedTrade` deduplicado por `(accountLogin, dealTicket)`.
  - Alimentar as abas **Relatórios** e **Operações** com o histórico consolidado do banco.

### 2. Propagação de Cores e Controles Operacionais
- Propagar as cores configuradas por `MagicNumber` para os gráficos e relatórios consolidados.
- Avaliar comandos operacionais remotos via fila `/pending` (ex.: pausar/zerar robô específico).