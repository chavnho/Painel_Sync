# Painel Sync MT5 (v0.7.0)

Dashboard web em tempo real para monitoramento e análise institucional de múltiplos robôs (Expert Advisors) no MetaTrader 5, desenvolvido com arquitetura bidirecional entre um coletor único MQL5 (`Painel_Sync.mq5`), servidor Node.js/Express com SSE e SQLite nativo (`server.ts` + `src/db/tradesDb.ts`) e interface React + TypeScript + Lightweight Charts v5.

## Arquitetura

- **EA Coletor Único (`src/utils/mt5Bridge.ts` / `Painel_Sync.mq5`)**: Código MQL5 100% embutido no frontend com injeção automática de `Endpoint`, `Channel ID` e `Auth Token`. Varre posições abertas, ordens pendentes e histórico de execuções agrupados por `MagicNumber`, além de atender solicitações sob demanda de candles via `/pending`.
- **Backend, Stream & Persistência (`server.ts` + `src/db/tradesDb.ts`)**: Normaliza a telemetria da conta e dos robôs, transmite atualizações em tempo real via Server-Sent Events (SSE) e persiste automaticamente o histórico de operações e preferências em SQLite nativo (`data/painel_sync.db`).
- **Frontend Institucional (`src/` + `src/utils/themeTokens.ts`)**: Paleta escura institucional (`#090D12` / `#0F141C`), curva de capital interativa `EquityBaselineChart` (`BaselineSeries` TradingView v5), sidebar sincronizada com a carteira ativa, `RootErrorBoundary` e relatórios históricos consolidados.

## Como Executar

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`, abra **Conectar MT5** para copiar o código do EA já configurado com seu `Channel ID` e `Auth Token`, compile no MetaEditor (`F7`) e anexe a um gráfico no MetaTrader 5.
