# Problemas do projeto Painel Sync MT5

Lista consolidada de problemas conhecidos, revisada. Referências de arquivo/linha podem variar conforme edições.

## Status de verificação (HEAD `3501e4f`, após `f35a02a` + `3501e4f`)

Legenda: ✅ corrigido e verificado · ⚠️ parcial · ❌ ainda presente

**✅ Corrigidos e verificados (14):** 1, 2, 5, 6, 10, 15, 16, 17, 18, 20, 21, 22, 26, 28
**⚠️ Parcial (1):** 4 — `OPEN_ORDER` já usa `sl`/`tp` (`Painel_Sync.mq5:537`), mas ainda não define `type_time`/expiration nem está exposto na UI.
**❌ Ainda presentes (19):** 3, 7, 8, 9, 11, 12, 13, 14, 19, 23, 24, 25, 27, 29, 30, 31, 32, 33, 34

Correções aplicadas nos commits `f35a02a`/`3501e4f` (verificadas de ponta a ponta):

- **#1 CLOSE_ALL — CORRIGIDO.** `enqueueCommand` (`tradesDb.ts:362`) grava `-1` quando não há magic; `mapCommandRow` (`:322`) devolve `undefined` para `< 0` (o JSON omite o campo); o EA (`Painel_Sync.mq5:498`) faz `tMg = (mgS != "") ? ... : -1` e, com `tMg < 0` + `InpIncludeManual` (padrão `true`), fecha **todas** as posições/ordens (`:521`, `:523`).
- **#15 persistência diária — CORRIGIDO.** `syncNewTelemetryTradesToDb` agora é chamada na telemetria em tempo real (`server.ts:884-888`), com `channel.account` já setado antes (`:765`) e `trades` populado (`normalizeRobotPayload`, `:300`); `persistExecutedTrades` usa upsert (`ON CONFLICT ...`) → sem duplicar.
- **#10 retry no service — CORRIGIDO.** Retry adicionado ao `serviceLifecycle` (`mt5Bridge.ts:221`) e presente no `.mq5` dentro do `while(!IsStopped())` do `OnStart` (`Painel_Sync.mq5:74`).
- **#2/#5/#6 e `.mq5` — CORRIGIDOS.** `Painel_Sync.mq5` sincronizado: `MODIFY_SL_TP` (`:528-531`), `CLOSE_ALL` com contagem de falhas/`okAll` (`:525-526`), `OPEN_ORDER` com `sl`/`tp` (`:537`) e `InpLogServer` em uso (`:949`).

Pendências notáveis (ver itens abaixo): #3 `_Period`→"M5", #7 `#property strict`, #8 parse JSON frágil, #9 `g_chartTempIdle`, #11 regex frágil, além de itens de backend/frontend/config.

## A) EA / MQL5 (`Painel_Sync.mq5` + template em `src/utils/mt5Bridge.ts`)

1. **`CLOSE_ALL` fecha só operações manuais (magic 0).** Cadeia: `RobotSidebar.tsx:145` envia `CLOSE_ALL` sem magic → `server.ts:1139` grava `Number(req.body?.magicNumber) || 0` → EA (`Painel_Sync.mq5:495`) assume `tMg=0` → filtra `POSITION_MAGIC != 0`. Resultado: "Zerar Tudo" não fecha os robôs.
2. **`MODIFY_SL_TP` aceito no backend mas inexistente no EA.** Está em `validActions` (`server.ts:1128`), mas `ExecuteRemoteCommand` só trata `CLOSE_MAGIC/CANCEL_ORDERS/CLOSE_ALL/OPEN_ORDER` → comando expira sem ACK.
3. **`_Period` = 0 em service.** `TimeframeToShortString(_Period)` (`Painel_Sync.mq5:376`) cai no `default` → retorna `"M5"` (`:1002`). Todo robô reporta M5.
4. **`OPEN_ORDER` ignora `sl`/`tp`** (`:522-529`), não define `type_time`/expiration e não está exposto na UI.
5. **ACK de `CLOSE_ALL` sempre `ok=true`** mesmo com falhas (`:520`).
6. **`InpLogServer`** declarado e nunca usado (`:28`).
7. **`#property strict`** é diretiva MQL4, ignorada em MQL5 (`:10`).
8. **Parse de JSON frágil:** `FetchPendingRequest` conta `{ } [ ]` de forma ingênua; quebra se uma string contiver esses caracteres.
9. **`g_chartTempIdle`** conta 20 ciclos de 2s ≈ 40s, mas o CHANGELOG diz 20s.
10. **Backfill histórico só no startup;** sem retry se o servidor estiver offline.
11. **Regex frágil de `OnInit/OnTimer → OnStart`** no template (`mt5Bridge.ts:237`): pode falhar silenciosamente se o ciclo de vida mudar.

## B) Backend (`server.ts`)

12. **Vazamentos sem limpeza:** `requestQueue`, `chartCandlesCache`, `activeChartFocus`, `lastChannelSignature`; o `DELETE /api/mt5-sync/:channelId` não limpa nada.
13. **Pedidos de candle sem TTL.**
14. **Código/arquivos mortos:** `processQueue` (morto em `server.ts`) e `queue.ts` (duplica lógica).
15. **Trades diários não persistidos:** só `isHistorySync` chama `persistExecutedTrades` → perda após reiniciar o servidor.
16. **Fallback de `GET /candles` retorna candles de outro timeframe** (chave genérica `${channelId}:${symKey}:`).
17. **`loadPersistedTradesForAccount` a cada snapshot (2s) sem cache;** variável `tfKey` sombreada.
18. **`acknowledgeCommand` não valida `channelId`.**
19. **Segurança:** token na query string do SSE; sem rate limiting; `OPEN_ORDER`/`MODIFY_SL_TP` negociam só com o token.

## C) Banco (`src/db/tradesDb.ts`)

20. **`loadPersistedTradesForAccount` usa `ORDER BY exit_date ASC ... LIMIT 3000`** → quando passa de 3000 trades, **descarta os mais recentes** (some o que você quer analisar).
21. **`command_queue` sem poda** de linhas antigas.

## D) Frontend

22. **Curva de PnL errada** em `TradingChartView.tsx:626` (`pnlCurve`): compara `exitTime` ("HH:MM:SS") com `c.timeLabel` ("YYYY.MM.DD HH:MM").
23. **Stale closure** no `useEffect` de candles (`TradingChartView.tsx`).
24. **`LivePairingMonitor.tsx` + `src/types/trading.ts`:** `source` tipado `'mt5'|'ping'|'unknown'`, mas o server envia `'backend'`/`'frontend'`; `outcome:'request'` fora do union → `SOURCE_LABELS[...]` indefinido.
25. **`RobotSidebar.tsx`:** imports não usados (`getPnlTextClass`, `ROBOT_COLORS`); `<div>` aninhado duplicado (~linha 382).
26. **`tradingMath.ts`:** `getPriceDigits` retorna 2 para WDO/DOL, mas o chart usa 1.
27. **`EquityBaselineChart.tsx`:** timestamps MT5 (hora local) tratados como UTC → deslocamento de 3h.
28. **`mt5Bridge.ts`:** `fetchCandles` sem `encodeURIComponent`.
29. **UI/docs contraditórias:** `Mt5BridgeView`/`ConnectView` dizem "100% somente leitura", mas há comandos remotos.

## E) Dependências / config / docs

30. **Arquivos mortos/duplicados:** `queue.ts`, `bridge_commit.ts`; `types.ts` vs `src/types/trading.ts`; `mt5Channels` exportado e não usado.
31. **`package.json`:** nome `"react-example"`, `start: "node server.ts"` (não roda TS), `clean: "rm -rf"` (não-Windows); deps sem uso: `@google/genai`, `motion`, `@xyflow/react`, `dsm`.
32. **`tsconfig.json`** sem `strict`/`noUnusedLocals`.
33. **Resquícios AI Studio:** `metadata.json` e `.env.example` (`GEMINI_API_KEY`, `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`).
34. **`CHANGELOG.md`** com encoding corrompido.

## Observações (o que NÃO é bug)

- Os marcadores `//'@`, `//Set-Content`, `//Write-Host` e as linhas `//////` no `.mq5` são **delimitadores de bloco intencionais**.
- O **template** em `mt5Bridge.ts` e o `Painel_Sync.mq5` estão **sincronizados** (commits `f35a02a`/`3501e4f`); ambos contêm as correções v0.7.1.
- **Service consegue negociar:** o teste de cancelar ordem pelo app provou que `OrderSend` funciona no service (falta validar `TRADE_ACTION_DEAL`, ou seja, fechar/abrir posição).
