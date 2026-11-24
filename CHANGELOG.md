# Changelog — Painel Sync MT5

## - 2026-11-24
### Adicionado
- **Persistência Histórica em SQLite (`src/db/tradesDb.ts` + `server.ts`)**: Armazenamento local em `data/painel_sync.db` utilizando `node:sqlite` (`DatabaseSync` em modo WAL), deduplicado por `(account_login, deal_ticket)`, com hidratação automática de `historyTrades` entre reinicializações do servidor.
- **Design Tokens & Tema Centralizado (`src/index.css` + `src/utils/themeTokens.ts`)**: Variáveis globais `@theme` no Tailwind v4, paleta `ROBOT_COLORS` compartilhada e formatadores semânticos (`getPnlTextClass`, `getSideTextClass`).
- **Propagação de Cores por MagicNumber**: Cor determinística por `MagicNumber` (customizável com um clique na barra lateral) sincronizada em tempo real nos Gráficos, Livro de Operações, Análise de Compras & Vendas e Relatórios.

### Melhorado
- **Análise de Compras & Vendas (`BuySellAnalyticsView.tsx`)**: Neutralização visual de valores zerados (`R$ 0,00`), alinhamento numérico à direita nas tabelas e badge do robô selecionado no cabeçalho.
- **Barra Lateral, Cabeçalho e Aba Conectar**: Cards destacados com borda lateral colorida, botão direto para Configuração EA no cabeçalho e horário local no Log de Pareamento.

## - 2026-11-24
### Adicionado
- Nomes amigáveis editáveis por `MagicNumber` na barra lateral propagados para todo o painel.
- Ordens pendentes (`BUY/SELL LIMIT` e `STOP`) e rótulos financeiros ao vivo (`pts` e `R$`) nos gráficos.
- Streaming incremental de candles (Snapshot + Delta de 2 velas) e autocomplete de ativos B3 por teclado.
- Exibição de Servidor, Tipo (`REAL`/`DEMO`), Modo (`HEDGE`/`NETTING`) e Margem Disponível.