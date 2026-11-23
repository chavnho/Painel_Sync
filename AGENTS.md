# Regras de Execução Autônoma
- Não interrompa a execução para pedir confirmações intermediárias; complete todas as etapas da tarefa de forma autônoma.
- NUNCA apenas descreva ou anuncie o próximo passo em texto: chame a ferramenta (read, edit, write, bash) imediatamente.
- Só encerre sua resposta quando todo o código estiver editado, verificado e funcionando.
- Se encontrar um erro ao rodar comandos ou testes, analise e corrija automaticamente antes de responder ao usuário.
- Mantenha o foco na conclusão da tarefa e evite pausas desnecessárias para explicações intermediárias.
# IDIOMA OBRIGATÓRIO
- Responda, explique e escreva todos os planos, resumos e comentários EXCLUSIVAMENTE em Português do Brasil (pt-BR).
- NUNCA mude para o inglês nas explicações ao usuário, mesmo após chamadas de ferramentas ou compactação de contexto.
# Proibição de Processos Bloqueantes (Servidores)
- NUNCA execute comandos de servidor de desenvolvimento ou processos contínuos (como `npm run dev`, `yarn start`, `vite`, `next dev`, `python app.py`, `uvicorn`, `docker compose up` sem `-d`).
- Se precisar testar a aplicação, rode apenas builds rápidos (`npm run build`), testes unitários que encerram sozinhos, ou peça ao usuário para iniciar o servidor manualmente em outro terminal.
 - Responda perguntas de forma objetiva e não realize alterações de código sem solicitação explícita do usuário.
# Arquitetura Bidirecional (Site <-> EA MQL5)
- O fluxo atual é bidirecional sob demanda (não apenas envio passivo do ativo do gráfico).
- O EA faz polling periódicos via `WebRequest("GET", ...)` em `/pending` para verificar se o frontend solicitou algum ativo/timeframe específico.
- Ao receber um pedido (`symbol`, `timeframe`, `requestId`), o EA ativa o símbolo com `SymbolSelect(symbol, true)`, coleta os candles via `CopyRates()` e devolve o JSON via `WebRequest("POST", ...)` contendo o mesmo `requestId`.
## Regras de Edição de Arquivos (Obrigatório)
- Ao usar a ferramenta `Edit`, envie APENAS UM bloco (hunk) por faixa de linhas e inclua somente o conteúdo final desejado (nunca pares antes/depois).
- Se a ferramenta `Edit` falhar 2 vezes no mesmo arquivo, NÃO tente novamente com `Edit`. Use a ferramenta `Write` para reescrever o arquivo inteiro de forma limpa.
## Caminhos de Arquivos (Obrigatório)
- Sempre use caminhos RELATIVOS à raiz do projeto (ex: `src/components/LivePairingMonitor.tsx`, `server.ts`).
- NUNCA escreva caminhos absolutos começando com `D:\Projetos\...`.
