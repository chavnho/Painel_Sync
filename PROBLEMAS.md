# Problemas do projeto Painel Sync MT5

Lista consolidada de problemas conhecidos, atualizada ap?s os commits `9b1bce8`, `8ac55c0`, `1af82b7` e `75d19dc`.

## Status de verificaéo

Legenda: ? corrigido e verificado ? é parcial ? ? ainda presente

**? Corrigidos e verificados (28):** 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 34
**é Parcial (1):** 4 ? `OPEN_ORDER` j? usa `sl`/`tp` (`Painel_Sync.mq5`), mas ainda n?o define `type_time`/expiration nem est? exposto na UI.
**? Ainda presentes (2 opcionais):** 12 (limpeza residual de `lastChannelSignature` caso reintroduzida em novos fluxos) e 32 (`tsconfig.json` sem `strict`/`noUnusedLocals`).

---

## Hist?rico de correées aplicadas

### Pacote MQL5 / Service (`9b1bce8`, `8ac55c0`)
- **#3 `_Period` = 0 em Service ? ? CORRIGIDO.** Adicionado `InpDefaultTimeframe` e `case PERIOD_CURRENT: return "";` em `TimeframeToShortString`.
- **#7 `#property strict` ? ? CORRIGIDO.** Removida diretiva MQL4 de `mt5Bridge.ts` e `Painel_Sync.mq5`.
- **#8 Parse de JSON fr?gil ? ? CORRIGIDO.** Implementado `FindJsonClosingDelim` com rastreamento de aspas e escapes em `FetchPendingRequest`.
- **#9 `g_chartTempIdle` ? ? CORRIGIDO.** Ajustado para `>= 10` ciclos de 2s (`20s`).
- **#11 Regex fr?gil de ciclo de vida ? ? CORRIGIDO.** Substitu?da por delimitadores expl?citos `// <EA_LIFECYCLE_START>` e `// <EA_LIFECYCLE_END>`.

### Pacote Frontend / Visual (`1af82b7`)
- **#23 Stale closure em `TradingChartView.tsx` ? ? CORRIGIDO.** Uso de `symbolRobotsRef` no polling de candles.
- **#24 `LivePairingMonitor.tsx` + `src/types/trading.ts` ? ? CORRIGIDO.** Tipagem e r?tulos adicionados para `backend`, `frontend` e `outcome: 'request'`.
- **#25 `RobotSidebar.tsx` ? ? CORRIGIDO.** Removidos imports n?o usados e `<div>` aninhada duplicada.
- **#27 `EquityBaselineChart.tsx` ? ? CORRIGIDO.** Alinhamento de `sessionStartSecRef` e `fallbackDayIsoRef` com `tzOffsetSec` (eliminando deslocamento de 3h).
- **#29 Textos contradit?rios ? ? CORRIGIDO.** `Mt5BridgeView.tsx` atualizado para documentar execuéo de comandos remotos autenticados pelo token.

### Pacote Backend, Seguran?a & Config (`75d19dc` + atual)
- **#13 TTL na `requestQueue` ? ? CORRIGIDO.** Pedidos de candle > 30s s?o expurgados automaticamente via `pruneExpiredRequests`.
- **#14 & #30 Arquivos e funées mortas ? ? CORRIGIDO.** Removidos `queue.ts`, `bridge_commit.ts`, `processQueue` e exports n?o utilizados de `mt5Channels`.
- **#19 Seguran?a ? ? CORRIGIDO.** Validaéo de `channel.token` em `GET /pending`, suporte a `Authorization: Bearer` e *rate limiting* leve em `/commands` e `/request`.
- **#31 `package.json` ? ? CORRIGIDO.** Nome atualizado para `painel-sync-mt5`, `start: "tsx server.ts"`, `clean` multiplataforma via Node e remoéo de depend?ncias n?o utilizadas.
- **#33 Resqu?cios AI Studio ? ? CORRIGIDO.** Limpeza de `.env.example` e `metadata.json`.
- **#34 `CHANGELOG.md` ? ? CORRIGIDO.** Encoding UTF-8 restaurado e entrada `v0.7.2` adicionada.
