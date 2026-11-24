# Roadmap — Painel Sync MT5

## Concluído até v0.4.0
- [x] Telemetria multi-robô agrupada por `MagicNumber` (`Painel_Sync.mq5` + `server.ts` via SSE).
- [x] Gráficos em tela cheia com Snapshot + Delta incremental, série contínua vinculada e ordens pendentes com rótulos financeiros.
- [x] Design Tokens centralizados (`src/index.css` + `src/utils/themeTokens.ts`) e propagação de cores por `MagicNumber` em todas as abas.
- [x] Persistência histórica em SQLite nativo (`data/painel_sync.db` via `node:sqlite`, deduplicada por conta e ticket).

## Próximas Etapas (v0.5.0)
1. **Comandos Operacionais Remotos via Fila `/pending`**:
   - Permitir enviar comandos do painel para o EA (ex.: zerar posição aberta de um `MagicNumber` específico ou cancelar ordens pendentes) com confirmação de segurança.
2. **Filtros Avançados e Exportação de Relatórios Históricos**:
   - Adicionar seletor de período customizado (datas inicial e final) consultando diretamente o banco SQLite.