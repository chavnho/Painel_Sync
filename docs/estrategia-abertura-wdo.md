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

## 3. Zonas de Abertura (5 Zonas)
- **Z1 (Acima da Maxima D-1):** Preco > Maxima_D1
- **Z2 (Canal da Maxima):** (Maxima_D1 - 7) <= Preco <= Maxima_D1
- **Z3 (Entre os Canais):** (Minima_D1 + 7) < Preco < (Maxima_D1 - 7)
- **Z4 (Canal da Minima):** Minima_D1 <= Preco <= (Minima_D1 + 7)
- **Z5 (Abaixo da Minima D-1):** Preco < Minima_D1

## 4. Saidas e Gestao de Risco
- **Take Profit:** 6 pontos
- **Stop Loss:** 10 pontos
- **Protecoes Extras (Breakeven / Trailing / Zeragem):** A definir

## 5. Gatilhos por Zona (Em Definicao)
- **Definicao da Zona (1o tick do dia vs tick atual):** Pendente
- **Papel das EMAs (13, 17, 21 H1/D1) e IFR(7):** Pendente
- **Z1:** Pendente
- **Z2:** Pendente
- **Z3:** Pendente
- **Z4:** Pendente
- **Z5:** Pendente
