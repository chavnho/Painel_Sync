# Summary — Painel Sync MT5

## Visão Geral
O **Painel Sync MT5** (v0.3.5) é um dashboard web em tempo real para monitoramento de múltiplos robôs (Expert Advisors) no MetaTrader 5, operando sobre uma arquitetura bidirecional entre um EA único (`Painel_Sync.mq5`), backend Node.js/Express (`server.ts` com SSE) e frontend React + TypeScript + Lightweight Charts.

## Funcionalidades Principais
- **Telemetria Multi-Robô por MagicNumber**: Agrupamento automático de posições abertas, ordens pendentes e negócios fechados por `MagicNumber`, com suporte a nomes amigáveis e tags de cor personalizadas no navegador.
- **Gráficos Profissionais em Tela Cheia**: Streaming incremental de candles (Snapshot + Delta), autocomplete de ativos B3 com navegação por teclado e linhas dinâmicas de Posição, SL, TP e Ordens Pendentes com pontos e PnL (R$) ao vivo.
- **Gestão de Conta e Pareamento**: Monitoramento de Margem Disponível, Modo de Conta (`HEDGE`/`NETTING`), Log de Pareamento com horário local e geração dinâmica do código `.mq5` com credenciais pré-preenchidas.
- **Análises e Relatórios**: Visão geral intraday, análise de compras vs. vendas, livro de operações filtrável e relatórios consolidados por robô.

## Próxima Etapa
- Persistência histórica de `ExecutedTrade` em banco SQLite local (`node:sqlite`), deduplicada por `(accountLogin, dealTicket)`, para manter o histórico completo entre reinicializações do servidor.