# Painel Sync MT5 (v0.7.0)

Dashboard web em tempo real para monitoramento e análise institucional de múltiplos robôs no MetaTrader 5, desenvolvido com arquitetura bidirecional entre um coletor único MQL5 (`Painel_Sync.mq5` — executável como **Serviço em 2º plano** ou **Expert Advisor**), servidor Node.js/Express com SSE e SQLite nativo (`server.ts` + `src/db/tradesDb.ts`) e interface React + TypeScript + Lightweight Charts v5.

## Arquitetura

- **Canal Bidirecional & Controle Remoto (`command_queue` + `RobotSidebar.tsx`)**: Fila persistente em SQLite com TTL de 15s e recibos (`ACK`) em tempo real via SSE permitindo encerrar posições por robô (`CLOSE_MAGIC`), cancelar ordens pendentes (`CANCEL_ORDERS`) e acionar **Zerar Tudo (Emergência)** com confirmação dupla.

- **Coletor Único MQL5 (`src/utils/mt5Bridge.ts` / `Painel_Sync.mq5`)**: Código MQL5 100% embutido no frontend com seletor entre **Serviço em 2º Plano (`MQL5\\Services\\`, `#property service`)** e **Expert Advisor (`MQL5\\Experts\\`)**, injeção automática de `Endpoint`, `Channel ID` e `Auth Token`, detecção automática de contratos vigentes B3 via `SYMBOL_EXPIRATION_TIME` (rolagem D-1 útil) e logs categorizados na aba *Experts*.
- **Backend, Stream & Persistência (`server.ts` + `src/db/tradesDb.ts`)**: Normaliza a telemetria da conta e dos robôs, detecta e classifica eventos de ordens e posições em tempo real via Server-Sent Events (SSE) e persiste automaticamente o histórico de operações e preferências em SQLite nativo (`data/painel_sync.db`).
- **Frontend & Sistema de Temas (`src/` + `src/index.css` + `src/utils/themeTokens.ts`)**: Tokens CSS globais com modal interativo de personalização ao vivo (*Institucional*, *Obsidiana OLED*, *Azul Ardósia* e *Grafite Suave*), curva de capital `EquityBaselineChart`, sidebar sincronizada, `RootErrorBoundary` e relatórios históricos consolidados.

## Como Executar

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`, abra **Conectar MT5**, escolha **Serviço (2º Plano)** ou **Expert Advisor (Gráfico)**, copie o código já configurado com seu `Channel ID` e `Auth Token`, compile no MetaEditor (`F7`) e inicie no MetaTrader 5.
