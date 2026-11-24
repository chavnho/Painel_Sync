# Painel Sync MT5 (v0.5.0)

Dashboard web em tempo real para monitoramento e análise de múltiplos robôs (Expert Advisors) no MetaTrader 5, desenvolvido com arquitetura bidirecional entre um coletor único MQL5 (`Painel_Sync.mq5`), servidor Node.js/Express com SSE e SQLite nativo (`server.ts` + `src/db/tradesDb.ts`) e interface React + TypeScript + Lightweight Charts.

## Arquitetura

- **EA Coletor Único (`Painel_Sync.mq5`)**: Varre posições abertas, ordens pendentes e histórico de execuções da conta agrupados por `MagicNumber`, além de atender solicitações sob demanda de candles via `/pending`.
- **Backend, Stream & Persistência (`server.ts` + `src/db/tradesDb.ts`)**: Normaliza a telemetria da conta e dos robôs, transmite atualizações em tempo real via Server-Sent Events (SSE) e persiste automaticamente o histórico de operações em SQLite nativo (`data/painel_sync.db`, deduplicado por `account_login` e `deal_ticket`).
- **Frontend & Design Tokens (`src/` + `src/utils/themeTokens.ts`)**: Interface escura padronizada com tokens Tailwind v4 (`@theme`), gráficos em tela cheia, nomes amigáveis e tags de cor determinísticas por `MagicNumber` propagadas por todo o sistema.

## Como Executar

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`, abra **Conectar MT5** para copiar o código do EA já configurado com seu `Channel ID` e `Auth Token`, compile no MetaEditor (`F7`) e anexe a um gráfico no MetaTrader 5.