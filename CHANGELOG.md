# Changelog — Painel Sync MT5

## - 2026-11-24
### Adicionado
- **Nomes Amigáveis e Tags de Cor por MagicNumber**: Edição inline de nomes e seleção rápida de cor na barra lateral (persistidos em `localStorage`) propagados para gráficos, relatórios e livro de operações.
- **Ordens Pendentes e Rótulos Financeiros no Gráfico**: Linhas pontilhadas de alto contraste para `BUY/SELL LIMIT` e `STOP`, `SL` e `TP`, com cálculo ao vivo de pontos e resultado financeiro (`R$`).
- **Streaming Incremental de Candles**: Carga inicial estendida + delta incremental de 2 velas e autocomplete de ativos B3 com navegação por teclado (`↑` / `↓` + `Enter`).
- **Diagnóstico de Conta MT5**: Exibição de Servidor, Tipo (`REAL`/`DEMO`), Modo (`HEDGE`/`NETTING`), Conta e Margem Disponível, com horário local no Log de Pareamento.

### Corrigido
- Aceitação de *heartbeat* sem robôs ativos (`robots: []`) no `server.ts` com `HTTP 200` na abertura do pregão.
- Vínculo automático entre série contínua (`WIN$N`, `WDO$N`) e contrato vigente no gráfico para exibição de posições abertas.
- Filtro de robô selecionado na tabela consolidada de Relatórios.

## - 2026-11-23
### Adicionado
- Sincronização de conta e robôs agrupados por `MagicNumber` via `Painel_Sync.mq5`.
- Catálogo de ativos futuros da B3 e gráfico de mercado dedicado.
- Gráfico automático por robô com linhas de entrada, SL, TP e marcadores de execução.