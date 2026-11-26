# Painel Sync MT5 (v0.8.0)

Dashboard web em tempo real para monitoramento, análise institucional e automação de múltiplos robôs no MetaTrader 5, desenvolvido com arquitetura bidirecional entre um coletor único MQL5 (`Painel_Sync.mq5` — executável como **Serviço em 2º plano** ou **Expert Advisor**), servidor Node.js/Express com SSE e SQLite nativo (`server.ts` + `src/db/tradesDb.ts`) e interface React + TypeScript + Lightweight Charts v5.

## Arquitetura & Funcionalidades

- **Construtor de Robôs Gerenciados (`RobotBuilderView.tsx` + `src/engine/robotEngine.ts`)**: Crie, edite e pause robôs diretamente no painel com alocação automática de `MagicNumber` (9001+), estratégias de **Cruzamento de Médias (EMA/SMA)**, **Reversão IFR (RSI)** e **Rompimento de Canal**, **Regra de Disparo Personalizável** por gatilho (*Comprar*, *Vender* ou *Ignorar*), trava de idempotência por candle e normalização automática de `tickSize`, `digits` e `volumeMin/Step/Max` via corretora/B3.
- **Simulador de Backtest & Replay Vela a Vela (`BacktestReplayView.tsx` + `src/engine/backtestSimulator.ts`)**: Valide qualquer robô sobre velas históricas reais do MT5 ou amostra sintética offline, com marcadores de entrada/saída (`C`, `V`, `TP`, `SL`), linhas de posição aberta, modo **Maximizar (ESC)** e controle de velocidade (`0.5x`, `1x`, `3x`, `10x`).
- **Canal Bidirecional & Controle Remoto (`command_queue` + `RobotSidebar.tsx`)**: Fila persistente em SQLite com TTL de 15s e recibos (`ACK`) em tempo real via SSE para abertura/fechamento de ordens (`OPEN_ORDER`, `CLOSE_MAGIC`, `CANCEL_ORDERS`, `CLOSE_ALL`) e **Zerar Tudo (Emergência)**.
- **Coletor Único MQL5 (`src/utils/mt5Bridge.ts` / `Painel_Sync.mq5`)**: Código MQL5 100% embutido no frontend com seletor entre **Serviço em 2º Plano (`MQL5\\Services\\`, `#property service`)** e **Expert Advisor (`MQL5\\Experts\\`)**, sincronização paralela de múltiplos ativos (`watchSymbols`), exportação de especificação de tick/lote e rolagem automática D-1 útil B3.
- **Backend, Stream & Persistência (`server.ts` + `src/db/tradesDb.ts`)**: Telemetria em tempo real via Server-Sent Events (SSE), persistência histórica em SQLite nativo (`data/painel_sync.db`) e backup automático `VACUUM INTO`.

## Scripts Principais

- `npm run dev` — Inicia o servidor Express + Vite em modo desenvolvimento.
- `npm run build` — Gera o bundle de produção.
- `npm run lint` — Executa a verificação estática TypeScript (`tsc --noEmit`).
