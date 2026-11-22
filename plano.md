# Plano de Desenvolvimento - Painel Sync MT5

## 🎯 Objetivo Principal
Implementar um mecanismo de **"Pull"** para buscar dados em tempo real do MetaTrader 5 (MT5) para qualquer ativo selecionado pelo usuário, tornando o gráfico independente de robôs ativos.

---

## ✅ Concluído
- [x] **Estrutura de Fila de Pedidos:** Implementada lógica básica de fila no backend.
- [x] **Endpoint de Solicitação:** Implementado `POST /api/mt5-sync/:channelId/request` para enviar pedidos ao robô.
- [x] **Processamento de Resposta:** Implementada lógica para identificar `requestId` no retorno do robô e atualizar a fila.

## 🚧 Em Andamento
- [ ] **Atualizar código .mq5 para busca sob demanda (CopyRates):** Modificar o EA para processar o `requestId` e retornar os dados.
- [ ] **Implementar resposta dinâmica no backend para o frontend:** Garantir que o snapshot enviado via SSE contenha os dados do pedido concluído.

## 🚀 Próximos Passos
- [ ] **Verificar e ajustar SymbolAutocomplete.tsx para filtro dinâmico**
- [ ] **Integrar lista dinâmica de símbolos no frontend**
- [x] **Estrutura de Fila de Pedidos:** Implementada lógica básica de fila no backend.

---

## 🚧 Em Andamento
- [ ] **Autocomplete de Ativos:** Substituir o campo de texto simples por um componente de seleção com filtro dinâmico (Combobox).
- [ ] **Integração de Lista Dinâmica:** Consumir a lista de símbolos vinda do novo endpoint do backend.

---

## 🚀 Próximos Passos (Fila de Pedidos)
1.  **Fila de Pedidos (Backend):** Criar uma estrutura de "Pedidos Pendentes" no `server.ts`.
2.  **Comunicação de Solicitação:** Fazer com que o backend envie um sinal de "Solicitação de Dados" para o robô (EA) conectado.
3.  **Busca sob Demanda (EA):** Atualizar o código `.mq5` para que, ao receber um pedido, ele use `CopyRates()` para buscar o ativo solicitado e retorne ao servidor.
4.  **Resposta Dinâmica:** O backend repassa os dados recebidos do robô para o frontend, atualizando o gráfico instantaneamente.

---

## 🛠️ Tecnologias Envolvidas
- **Frontend:** React, Tailwind CSS, Lucide React.
- **Backend:** Node.js, Express, SSE (Server-Sent Events).
- **Trading:** MetaTrader 5 (MQL5).
- [ ] **Corrigir erros de tipagem no server.ts:** Definir PendingRequest, mt5Channels, PairingAttemptEvent e funções auxiliares.
- [ ] **Adicionar estados e refs ausentes no TradingChartView.tsx:** (setSelectedSymbol, previousSymbolRef, setManualCandles, etc.)
- [ ] **Corrigir assinatura de fetchSymbols e lógica de manualCandles no TradingChartView.tsx**

---

## 🔮 Plano Futuro — Combobox de Ativos (evitar digitação errada)

**Objetivo:** substituir o campo de texto livre da aba Mercado (`IndependentChartView`) por um combobox com filtro de digitação, contendo os ativos reais da corretora, para impedir que o usuário peça símbolos inválidos (ex.: `PETR` em vez de `PETR4`).

**Etapas:**
- [ ] **EA (MQL5):** reportar a lista de símbolos ao backend — Market Watch via `SymbolsTotal(true)`/`SymbolName(i, true)` (opcionalmente todos, com filtro por sufixo da corretora). Enviar em um POST periódico (campo `symbols`) ou responder a um comando `listSymbols` no `/pending`.
- [ ] **Backend:** armazenar a lista por canal em `mt5Channels` e expor `GET /api/mt5-sync/:channelId/symbols` (validação de token, resposta em JSON).
- [ ] **Frontend:** buscar a lista e alimentar o `SymbolAutocomplete` já existente (`src/components/SymbolAutocomplete.tsx`), hoje sem uso.
- [ ] **UX:** usar o componente na aba Mercado; só disparar o pedido ao EA após selecionar um item da lista (ou Enter), eliminando requisições de símbolos parciais.
- [ ] **Fallback:** se a lista ainda não estiver disponível, manter texto livre + sugestões dos símbolos conhecidos e validar no EA (`SymbolSelect`), retornando erro claro.

**Benefícios:** menos requisições inválidas, feedback imediato de erro de digitação e melhor descoberta dos ativos disponíveis na corretora.
