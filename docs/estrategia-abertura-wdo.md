# Especificacao: Estrategia Abertura WDO

## 1. Configuracao Geral
- **Ativos:** WDO$ / WDO@N (Dolar Futuro B3)
- **Timeframe Base:** M5
- **Modo de Avaliacao:** Tick a tick desde o 1o negocio pos-leilao (09:00 BRT)
- **Frequencia:** Maximo de 1 operacao por dia
- **Janela de Entrada:** Sem trava maxima rigida (geralmente ocorre antes das 09:30, ou depois se abrir lateral)

## 2. Indicadores e Niveis de Referencia
- **EMAs H1:** Periodos 13, 17 e 21
- **EMAs D1:** Periodos 13, 17 e 21
- **Oscilador:** IFR (RSI) de 7 periodos no M5
- **Canal Superior (Maxima D-1):** Entre Maxima_D1 e (Maxima_D1 - 7 pts)
- **Canal Inferior (Minima D-1):** Entre Minima_D1 e (Minima_D1 + 7 pts)

## 3. Zonas de Abertura (Definidas pelo 1o Tick do Dia)
- **Regra de Exclusividade:** A zona onde ocorre o 1o tick da abertura define o modo do dia e anula todas as outras zonas.
- **Z1 (Acima da Maxima D-1):** Preco_Abertura > Maxima_D1
- **Z2 (Canal da Maxima):** (Maxima_D1 - 7) <= Preco_Abertura <= Maxima_D1
- **Z3 (Entre os Canais):** (Minima_D1 + 7) < Preco_Abertura < (Maxima_D1 - 7)
- **Z4 (Canal da Minima):** Minima_D1 <= Preco_Abertura <= (Minima_D1 + 7)
- **Z5 (Abaixo da Minima D-1):** Preco_Abertura < Minima_D1

## 4. Arquitetura dos Gatilhos (Tipo A e Tipo B)
- **Prioridade Tipo A (Indicadores - 1A, 2A, 3A, 4A, 5A):** Avaliada primeiro com base nas EMAs (13, 17, 21 H1/D1) e IFR(7).
- **Contingencia Tipo B (Rompimento - 1B, 2B, 3B, 4B, 5B):** So executa se a entrada Tipo A ainda NAO tiver sido executada. Opera no rompimento (>= Maxima ou <= Minima da vela anterior de M5) e segue armada ate executar a operacao unica do dia.

## 5. Saidas e Gestao de Risco
- **Take Profit:** 6 pontos
- **Stop Loss:** 10 pontos
- **Protecoes Extras (Breakeven / Trailing / Zeragem):** A definir

## 6. Detalhamento por Zona (Pendente)
- **Z1 (1A e 1B):** Pendente
- **Z2 (2A e 2B):** Pendente
- **Z3 (3A e 3B):** Pendente
- **Z4 (4A e 4B):** Pendente
- **Z5 (5A e 5B):** Pendente
