# Plano de Desenvolvimento - Painel Sync MT5

## 🎯 Objetivo
Permitir que o painel solicite candles de qualquer ativo ao EA (MetaTrader 5) sob demanda, independente dos robôs ativos, evitando requisições com símbolos inválidos ao usar a lista real de ativos da corretora.

## ✅ Concluído
- [x] Fila de pedidos no backend (`queue.ts` + `requestQueue` em `server.ts`), FIFO com estados `pending`/`processing`/`completed`/`failed`.
- [x] `POST /api/mt5-sync/:channelId/request` para enfileirar pedidos.
- [x] `GET /api/mt5-sync/:channelId/pending` para o EA consumir os pedidos.
- [x] Processamento da resposta por `requestId` no `POST /api/mt5-sync/:channelId`.
- [x] EA (`Painel_Sync.mq5`) usa `SymbolSelect` + `CopyRates` e devolve o `requestId`.
- [x] Frontend (`syncCandlesWithMt5`) solicita candles e faz polling de `/candles`.
- [x] Correções de tipagem (`server.ts`, `TradingChartView`) com `lint` e `build` limpos.
- [x] Autocomplete real na aba Gráficos baseado nos símbolos dos robôs.

## 🚧 Em andamento (implementação atual)
- [ ] EA reportar a lista de símbolos (Market Watch via `SymbolsTotal(true)`/`SymbolName`) ao backend.
- [ ] Backend armazenar a lista por canal e expor `GET /api/mt5-sync/:channelId/symbols`.
- [ ] Aba Mercado usar `SymbolAutocomplete` alimentado pela lista vinda do MT5.
- [ ] Só disparar o pedido ao selecionar um item da lista (remover o debounce de 700 ms por digitação).
- [ ] Fallback quando a lista ainda não chegou: mensagem clara, sem disparar pedidos parciais.

## 🔮 Futuro
- [ ] Filtrar símbolos por sufixo da corretora / categorias.
- [ ] Cache da lista por canal com TTL.
- [ ] Alinhar o template MQL5 gerado em `src/utils/mt5Bridge.ts` ao `Painel_Sync.mq5` real.
