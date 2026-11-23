## Monitoramento de Robôs em Tempo Real

### ✅ Etapas para Implementação
1. **Corrigir `LivePairingMonitor.tsx`**:
   - Concluir importações e definições de tipos.
   - Adicionar lógica para ler `mt5Channels` e exibir robôs.

2. **Escolher estratégia de comunicação**:
   - **Opção A**: Sincronização via conta (robôs enviam todos os dados).
   - **Opção B**: Comunicação individual (cada robô envia apenas seus dados, ex: `EaZonas`).

3. **Atualizar `types.ts`**:
   - Adicionar campos para identificar robôs (ex: `robotId`).

4. **Testar com `EaZonas`**:
   - Implementar comunicação individual no robô (se escolher Opção B).
