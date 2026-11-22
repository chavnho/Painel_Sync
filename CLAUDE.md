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
- **Uso de Python para Edições Complexas:** Quando a ferramenta `edit` falhar ou quando o conteúdo contiver caracteres que possam ser interpretados incorretamente pelo shell (como colchetes `[]` em Markdown), use scripts Python via `bash` para realizar a substituição de texto de forma segura.
# Arquitetura Bidirecional (Site <-> EA MQL5)
- O fluxo atual é bidirecional sob demanda (não apenas envio passivo do ativo do gráfico).
- O EA faz polling periódicos via `WebRequest("GET", ...)` em `/pending` para verificar se o frontend solicitou algum ativo/timeframe específico.
- Ao receber um pedido (`symbol`, `timeframe`, `requestId`), o EA ativa o símbolo com `SymbolSelect(symbol, true)`, coleta os candles via `CopyRates()` e devolve o JSON via `WebRequest("POST", ...)` contendo o mesmo `requestId`.
