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

## 3. Zonas de Abertura e Direcao Permitida (Definidas pelo 1o Tick do Dia)
- **Regra de Exclusividade:** A zona onde ocorre o 1o tick da abertura define o modo do dia e anula todas as outras zonas.
- **Z1 (Acima da Maxima D-1):** Preco_Abertura > Maxima_D1 -> **Somente VENDA**
- **Z2 (Canal da Maxima):** (Maxima_D1 - 7) <= Preco_Abertura <= Maxima_D1 -> **Somente VENDA**
- **Z3 (Entre os Canais):** (Minima_D1 + 7) < Preco_Abertura < (Maxima_D1 - 7) -> **COMPRA ou VENDA**
- **Z4 (Canal da Minima):** Minima_D1 <= Preco_Abertura <= (Minima_D1 + 7) -> **Somente COMPRA**
- **Z5 (Abaixo da Minima D-1):** Preco_Abertura < Minima_D1 -> **Somente COMPRA**

## 4. Arquitetura dos Gatilhos (Tipo A e Tipo B)
- **Prioridade Tipo A (1A, 2A, 3A, 4A, 5A):** Avaliada durante a 1a vela de M5 do pregao.
- **Contingencia Tipo B (1B, 2B, 3B, 4B, 5B):** Assume apos o fechamento da 1a vela de M5 caso a entrada Tipo A nao tenha sido executada (ou imediatamente se Tipo A for invalidada na abertura). Segue armada vela a vela monitorando rompimento da vela anterior de M5 ate executar a operacao unica do dia.

## 5. Detalhamento por Zona
- **Z1 (Somente Venda):**
  - **1A (IFR 7 na 1a vela M5):**
    - Se abrir ja com IFR(7) >= 90: nao entra, cancela 1A e **1B assume** (aguardando fechamento da 1a vela M5).
    - Se abrir com IFR(7) >= 86 e < 90: **VENDE a mercado** imediatamente.
    - Se abrir com IFR(7) < 86: monitora tick a tick durante a 1a vela de M5; se o IFR(7) atingir a faixa (>= 86 e < 90), **VENDE a mercado** imediatamente.
    - Se a 1a vela fechar sem executar 1A: **1B assume** a partir da 2a vela de M5.
  - **1B (Rompimento):** **VENDA** quando Preco >= Maxima OU Preco <= Minima da vela anterior de M5.
- **Z2 (Somente Venda):**
  - **2A (Rompimento das bordas do Canal Superior na 1a vela M5):** Durante a 1a vela de M5, **VENDE a mercado** se Preco >= (Maxima_D1 + 1 tick) OU Preco <= (Maxima_D1 - 7 - 1 tick). Se fechar a 1a vela sem romper, **2B assume** a partir da 2a vela de M5.
  - **2B (Rompimento):** **VENDA** quando Preco >= Maxima OU Preco <= Minima da vela anterior de M5.
- **Z3 (Compra ou Venda - Reversao nas extremidades):**
  - **3A (EMAs / Indicadores):** Pendente
  - **3B (Rompimento):** **COMPRA** quando Preco <= Minima da vela anterior de M5 OU **VENDA** quando Preco >= Maxima da vela anterior de M5.
- **Z4 (Somente Compra):**
  - **4A (Rompimento das bordas do Canal Inferior na 1a vela M5):** Durante a 1a vela de M5, **COMPRA a mercado** se Preco >= (Minima_D1 + 7 + 1 tick) OU Preco <= (Minima_D1 - 1 tick). Se fechar a 1a vela sem romper, **4B assume** a partir da 2a vela de M5.
  - **4B (Rompimento):** **COMPRA** quando Preco >= Maxima OU Preco <= Minima da vela anterior de M5.
- **Z5 (Somente Compra):**
  - **5A (IFR 7 na 1a vela M5):**
    - Se abrir ja com IFR(7) <= 10: nao entra, cancela 5A e **5B assume** (aguardando fechamento da 1a vela M5).
    - Se abrir com IFR(7) > 10 e <= 16: **COMPRA a mercado** imediatamente.
    - Se abrir com IFR(7) > 16: monitora tick a tick durante a 1a vela de M5; se o IFR(7) atingir a faixa (> 10 e <= 16), **COMPRA a mercado** imediatamente.
    - Se a 1a vela fechar sem executar 5A: **5B assume** a partir da 2a vela de M5.
  - **5B (Rompimento):** **COMPRA** quando Preco >= Maxima OU Preco <= Minima da vela anterior de M5.

## 6. Saidas e Gestao de Risco
- **Take Profit:** 6 pontos
- **Stop Loss:** 10 pontos
- **Protecoes Extras (Breakeven / Trailing / Zeragem):** A definir
