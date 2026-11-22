## Objetivo
- Implementar um mecanismo de "Pull" no robô do MetaTrader 5 (MT5) para buscar dados em tempo real sob demanda do backend.

## Detalhes Importantes
- O backend já gerencia uma fila de requisições e envia sinais (`outcome: "request"`) para o robô.
- O robô (`temp_gen.mq5`) precisa monitorar ou receber essas requisições, buscar os dados usando `CopyRates()` e retornar com o `requestId` correspondente.
- Python está instalado e deve ser usado para edições complexas de arquivos ou quando a ferramenta `edit` falhar devido à interpretação do shell de caracteres especiais (como `[]` em Markdown).
- O arquivo `server.ts` foi atualizado para incluir a lógica de `types.ts` e `queue.ts`, mas alguns erros de tipo e funções ausentes (`pushPairingEvent`, `failRequest`) ainda precisam ser corrigidos.

## Estado do Trabalho
### Concluído
- Leitura de `progress_summary.md` e `plano.md`.
- Identificação e definição de interfaces ausentes (`PendingRequest`, `PairingAttemptEvent`) e o mapa `mt5Channels` em `types.ts`.
- Criação do `queue.ts` para lidar com a lógica da fila de requisições.
- Atualização do `server.ts` para importar e usar a nova lógica de fila.
- Criação de um arquivo temporário `temp_server_fixed.ts` contendo o código completo e corrigido para o servidor.
- Adição de uma regra ao `AGENTS.md` para usar scripts Python para edições seguras de arquivos.

### Ativo
- Correção de erros de tipo e funções ausentes em `server.ts` (especificamente `pushPairingEvent` e `failRequest`).
- Implementação da lógica de "Pull" dentro do arquivo `.mq5` do robô.
- Adição de estados e refs ausentes em `TradingChartView.tsx` (ex: `setSelectedSymbol`, `previousSymbolRef`, `setManualCandles`).

### Bloqueado
- `tsc --noEmit` está falhando com múltiplos erros em `server.ts` e `TradingChartView.tsx` devido a variáveis ausentes e assinaturas de função incorretas.
- A interpretação do shell de colchetes Markdown `[]` causou falhas em comandos `edit` anteriores.

## Próximos Passos
1. Corrigir os erros de tipo e funções ausentes em `server.ts` integrando a lógica de `temp_server_fixed.ts`.
2. Atualizar `TradingChartView.tsx` com os estados, refs e assinatura corrigida de `fetchSymbols`.
3. Finalizar a lógica de `FetchPendingRequest` no arquivo `.mq5`.

## Arquivos Relevantes
- `D:\Projetos\painel-sync\server.ts`: Lógica principal do backend; atualmente com erros de tipo e funções ausentes.
- `D:\Projetos\painel-sync\types.ts`: Tipos centralizados para o projeto.
- `D:\Projetos\painel-sync\queue.ts`: Lógica para gerenciar a fila de requisições.
- `D:\Projetos\painel-sync\temp_server_fixed.ts`: Contém a versão corrigida de `server.ts`.
- `D:\Projetos\painel-sync\temp_gen.mq5`: Arquivo do robô MT5 que requer a implementação da lógica de "Pull".
- `D:\Projetos\painel-sync\src\components\TradingChartView.tsx`: Componente frontend com estados e refs ausentes.
- `D:\Projetos\painel-sync\AGENTS.md`: Contém regras de execução, incluindo a nova regra de edição baseada em Python.
