import type {
  LiveCandle,
  Mt5SyncCredentials,
} from '../types/trading';

const STORAGE_KEY = 'painel_sync_mt5_credentials_v2';

function randomId(prefix: string, length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = prefix;
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function loadOrCreateMt5SyncCredentials(): Mt5SyncCredentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Mt5SyncCredentials>;
      if (parsed.channelId && parsed.token) {
        return { channelId: parsed.channelId, token: parsed.token };
      }
    }
  } catch {
    // ignora storage inválido
  }
  return regenerateMt5SyncCredentials();
}

export function regenerateMt5SyncCredentials(): Mt5SyncCredentials {
  const creds: Mt5SyncCredentials = {
    channelId: randomId('ps_', 10),
    token: randomId('tk_', 18),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // ignora erro de storage
  }
  return creds;
}

export function buildPainelSyncMql5(params: {
  endpointUrl: string;
  token: string;
  magicNumber: number;
  robotName: string;
}): string {
  return `//+------------------------------------------------------------------+
//|                                                  PainelSync.mq5  |
//|     Monitor Multi-Robo Somente Leitura para Painel Sync (MT5)    |
//+------------------------------------------------------------------+
#property copyright "Painel Sync"
#property version   "3.00"
#property description "Espelha todos os robos (Magic Numbers), posicoes, compras/vendas e candles."
#property description "100% SOMENTE LEITURA: nao abre, modifica ou fecha ordens."

//--- Configuracoes de Conexao
input string   InpEndpointUrl       = "${params.endpointUrl}"; // URL do Endpoint Painel Sync
input string   InpSyncToken         = "${params.token}";       // Token de Pareamento (x-sync-token)
input ulong    InpMagicNumber       = ${params.magicNumber};   // Magic Number (0 = todos os robos)
input string   InpNomeRobo          = "${(params.robotName || 'Robo_MT5').replace(/"/g, '')}"; // Nome padrao (quando Magic > 0)
input bool     InpTodosAtivos       = true;                    // Capturar todos os ativos da conta (true) ou so o grafico
input int      InpDiasOperacoes     = 7;                       // Dias exibidos em Operacoes (1=hoje, 7=semana, 30=mes)
input int      InpIntervaloSegundos = 2;                       // Intervalo de envio (segundos)
input int      InpMaxCandles        = 150;                     // Candles por timeframe no ativo principal

struct BotPair
{
   ulong  magic;
   string sym;
};

void AddBotPair(BotPair &list[], ulong magic, string sym)
{
   if(sym == "") return;
   int total = ArraySize(list);
   for(int i = 0; i < total; i++)
   {
      if(list[i].magic == magic && list[i].sym == sym) return;
   }
   if(total >= 15) return;
   ArrayResize(list, total + 1);
   list[total].magic = magic;
   list[total].sym = sym;
}

string EnumTimeframeLabel(ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M2:  return "M2";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_D1:  return "D1";
      default:         return EnumToString(tf);
   }
}

string EscapeJson(string s)
{
   StringReplace(s, "\\\\", "\\\\\\\\");
   StringReplace(s, "\\"", "\\\\\\"");
   StringReplace(s, "\\r", " ");
   StringReplace(s, "\\n", " ");
   return s;
}

string BuildRatesJson(string sym, ENUM_TIMEFRAMES tf, int digits, int maxBars)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(sym, tf, 0, maxBars, rates);
   if(copied <= 0) return "[]";

   string out = "[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) out += ",";
      string tLabel = TimeToString(rates[i].time, TIME_MINUTES);
      out += StringFormat(
         "{\\"time\\":%I64d,\\"timeLabel\\":\\"%s\\",\\"open\\":%s,\\"high\\":%s,\\"low\\":%s,\\"close\\":%s,\\"volume\\":%I64d}",
         (long)rates[i].time,
         tLabel,
         DoubleToString(rates[i].open, digits),
         DoubleToString(rates[i].high, digits),
         DoubleToString(rates[i].low, digits),
         DoubleToString(rates[i].close, digits),
         rates[i].tick_volume
      );
   }
   out += "]";
   return out;
}

bool FindEntryDeal(int curIndex, long posId, double &outPrice, datetime &outTime)
{
   if(posId <= 0) return false;
   for(int j = curIndex - 1; j >= 0; j--)
   {
      ulong tIn = HistoryDealGetTicket(j);
      if(tIn == 0) continue;
      if(HistoryDealGetInteger(tIn, DEAL_POSITION_ID) != posId) continue;
      long inEntry = HistoryDealGetInteger(tIn, DEAL_ENTRY);
      if(inEntry == DEAL_ENTRY_IN || inEntry == DEAL_ENTRY_INOUT)
      {
         outPrice = HistoryDealGetDouble(tIn, DEAL_PRICE);
         outTime  = (datetime)HistoryDealGetInteger(tIn, DEAL_TIME);
         return true;
      }
   }
   return false;
}

bool g_conectadoLogado = false;

int OnInit()
{
   int sec = MathMax(1, InpIntervaloSegundos);
   if(!EventSetTimer(sec))
   {
      Print("PainelSync: falha ao inicializar timer.");
      return(INIT_FAILED);
   }
   Print("PainelSync v3 iniciado no grafico ", _Symbol, " | Endpoint: ", InpEndpointUrl);
   EnviarTelemetria();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   // Envio consolidado via OnTimer para nao atrasar execucao de ordens
}

void OnTimer()
{
   EnviarTelemetria();
}

void EnviarTelemetria()
{
   datetime agoraSrv = TimeTradeServer();
   datetime agoraCur = TimeCurrent();
   datetime refTime = (agoraSrv > agoraCur) ? agoraSrv : agoraCur;
   datetime fimHist = refTime + 86400;

   MqlDateTime dt;
   TimeToStruct(refTime, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime inicioDia = StructToTime(dt);
   int diasOps = MathMax(1, MathMin(30, InpDiasOperacoes));
   datetime inicioOps = inicioDia - (diasOps - 1) * 86400;
   datetime inicio30d = inicioDia - 30 * 86400;

   BotPair pairs[];
   ArrayResize(pairs, 0);

   // 1. Descobre posicoes abertas
   for(int p = 0; p < PositionsTotal(); p++)
   {
      ulong ticket = PositionGetTicket(p);
      if(ticket == 0) continue;
      string pSym = PositionGetString(POSITION_SYMBOL);
      if(!InpTodosAtivos && pSym != _Symbol) continue;
      ulong pMagic = (ulong)PositionGetInteger(POSITION_MAGIC);
      if(InpMagicNumber > 0 && pMagic != InpMagicNumber) continue;
      AddBotPair(pairs, pMagic, pSym);
   }

   // 2. Descobre robos e ativos no historico recente (ordem reversa para priorizar os mais novos)
   if(HistorySelect(inicio30d, fimHist))
   {
      int totalHist = HistoryDealsTotal();
      for(int i = totalHist - 1; i >= 0; i--)
      {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;
         long dType = HistoryDealGetInteger(ticket, DEAL_TYPE);
         if(dType != DEAL_TYPE_BUY && dType != DEAL_TYPE_SELL) continue;

         string dSym = HistoryDealGetString(ticket, DEAL_SYMBOL);
         if(!InpTodosAtivos && dSym != _Symbol) continue;
         ulong dMagic = (ulong)HistoryDealGetInteger(ticket, DEAL_MAGIC);
         if(InpMagicNumber > 0 && dMagic != InpMagicNumber) continue;

         AddBotPair(pairs, dMagic, dSym);
      }
   }

   // Garante ao menos o grafico atual caso ainda nao existam negocios
   if(ArraySize(pairs) == 0)
   {
      AddBotPair(pairs, InpMagicNumber, _Symbol);
   }

   string robotsJson = "[";
   double totalAccountDailyPnl = 0.0;
   int validRobots = 0;
   int totalChartCandles = 0;

   for(int b = 0; b < ArraySize(pairs); b++)
   {
      ulong magic = pairs[b].magic;
      string sym = pairs[b].sym;
      SymbolSelect(sym, true);

      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      int maxC = (sym == _Symbol) ? InpMaxCandles : MathMin(InpMaxCandles, 80);

      MqlRates rates[];
      ArraySetAsSeries(rates, false);
      int copied = CopyRates(sym, _Period, 0, maxC, rates);
      if(copied <= 0) continue;
      if(sym == _Symbol) totalChartCandles = copied;

      string candlesJson = BuildRatesJson(sym, _Period, digits, maxC);
      string tfMapJson = "{\\"M1\\":" + BuildRatesJson(sym, PERIOD_M1, digits, maxC)
                       + ",\\"M5\\":" + BuildRatesJson(sym, PERIOD_M5, digits, maxC)
                       + ",\\"M15\\":" + BuildRatesJson(sym, PERIOD_M15, digits, maxC)
                       + ",\\"H1\\":" + BuildRatesJson(sym, PERIOD_H1, digits, maxC) + "}";

      // Posicao aberta deste robo/ativo
      string posJson = "null";
      double floatingPnlTotal = 0.0;
      double lastClose = rates[copied - 1].close;
      for(int p = 0; p < PositionsTotal(); p++)
      {
         ulong ticket = PositionGetTicket(p);
         if(ticket == 0) continue;
         if(PositionGetString(POSITION_SYMBOL) != sym) continue;
         ulong posMagic = (ulong)PositionGetInteger(POSITION_MAGIC);
         if(posMagic != magic) continue;

         long pType = PositionGetInteger(POSITION_TYPE);
         string side = (pType == POSITION_TYPE_BUY) ? "COMPRA" : "VENDA";
         double vol = PositionGetDouble(POSITION_VOLUME);
         double entry = PositionGetDouble(POSITION_PRICE_OPEN);
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         double floatPnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         floatingPnlTotal += floatPnl;
         string openTime = TimeToString((datetime)PositionGetInteger(POSITION_TIME), TIME_MINUTES);

         posJson = StringFormat(
            "{\\"id\\":\\"%I64u\\",\\"side\\":\\"%s\\",\\"volume\\":%.2f,\\"entryPrice\\":%s,\\"currentPrice\\":%s,\\"sl\\":%s,\\"tp\\":%s,\\"floatingPnlBrl\\":%.2f,\\"openTime\\":\\"%s\\"}",
            ticket, side, vol,
            DoubleToString(entry, digits),
            DoubleToString(lastClose, digits),
            DoubleToString(sl, digits),
            DoubleToString(tp, digits),
            floatPnl,
            openTime
         );
         break;
      }

      // Negocios recentes (InpDiasOperacoes) + historico 30d
      double dailyRealized = 0.0;
      string tradesJson = "[";
      string histJson = "[";
      string markersJson = "[";
      int tradeCount = 0;
      int histCount = 0;
      int markerCount = 0;

      if(HistorySelect(inicio30d, fimHist))
      {
         int totalDeals = HistoryDealsTotal();
         for(int i = 0; i < totalDeals; i++)
         {
            ulong ticket = HistoryDealGetTicket(i);
            if(ticket == 0) continue;
            if(HistoryDealGetString(ticket, DEAL_SYMBOL) != sym) continue;
            ulong dMagic = (ulong)HistoryDealGetInteger(ticket, DEAL_MAGIC);
            if(dMagic != magic) continue;

            long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);
            long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
            if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

            double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                          + HistoryDealGetDouble(ticket, DEAL_SWAP)
                          + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
            datetime dTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
            double dPrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
            double dVol = HistoryDealGetDouble(ticket, DEAL_VOLUME);

            if(dTime >= inicioDia)
            {
               dailyRealized += profit;

               int cIdx = copied - 1;
               for(int c = copied - 1; c >= 0; c--)
               {
                  if(rates[c].time <= dTime) { cIdx = c; break; }
               }
               bool isExitMarker = (entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_INOUT || entryType == DEAL_ENTRY_OUT_BY);
               string mType = isExitMarker ? "exit" : ((dealType == DEAL_TYPE_BUY) ? "buy" : "sell");
               string mLabel = isExitMarker ? StringFormat("Saida R$ %.2f", profit)
                              : ((dealType == DEAL_TYPE_BUY) ? "Compra MT5" : "Venda MT5");
               if(markerCount > 0) markersJson += ",";
               markersJson += StringFormat(
                  "{\\"candleIndex\\":%d,\\"price\\":%s,\\"type\\":\\"%s\\",\\"label\\":\\"%s\\"}",
                  cIdx, DoubleToString(dPrice, digits), mType, mLabel
               );
               markerCount++;
            }

            if(entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_INOUT || entryType == DEAL_ENTRY_OUT_BY)
            {
               string sideLabel = (dealType == DEAL_TYPE_SELL) ? "COMPRA" : "VENDA";
               double inPrice = dPrice;
               datetime inTime = dTime;
               long posId = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
               FindEntryDeal(i, posId, inPrice, inTime);

               string inTimeStr = TimeToString(inTime, TIME_MINUTES);
               string inDateStr = TimeToString(inTime, TIME_DATE);
               StringReplace(inDateStr, ".", "-");

               string outTimeStr = TimeToString(dTime, TIME_MINUTES);
               string outDateStr = TimeToString(dTime, TIME_DATE);
               StringReplace(outDateStr, ".", "-");

               string itemJson = StringFormat(
                  "{\\"id\\":\\"%I64u\\",\\"side\\":\\"%s\\",\\"entryDate\\":\\"%s\\",\\"exitDate\\":\\"%s\\",\\"entryTime\\":\\"%s\\",\\"exitTime\\":\\"%s\\",\\"entryPrice\\":%s,\\"exitPrice\\":%s,\\"volume\\":%.2f,\\"pnlBrl\\":%.2f,\\"reason\\":\\"%s\\"}",
                  ticket, sideLabel, inDateStr, outDateStr, inTimeStr, outTimeStr,
                  DoubleToString(inPrice, digits), DoubleToString(dPrice, digits),
                  dVol, profit, EscapeJson(HistoryDealGetString(ticket, DEAL_COMMENT))
               );

               if(dTime >= inicioOps && tradeCount < 300)
               {
                  if(tradeCount > 0) tradesJson += ",";
                  tradesJson += itemJson;
                  tradeCount++;
               }

               if(histCount < 600)
               {
                  if(histCount > 0) histJson += ",";
                  histJson += itemJson;
                  histCount++;
               }
            }
         }
      }

      tradesJson += "]";
      histJson += "]";
      markersJson += "]";

      string botName = (InpMagicNumber > 0)
         ? EscapeJson(InpNomeRobo)
         : (magic > 0 ? StringFormat("EA #%I64u (%s)", magic, EscapeJson(sym)) : StringFormat("Manual (%s)", EscapeJson(sym)));

      double botDailyPnl = dailyRealized + floatingPnlTotal;
      totalAccountDailyPnl += botDailyPnl;

      if(validRobots > 0) robotsJson += ",";
      robotsJson += "{\\"robotId\\":\\"" + IntegerToString((long)magic) + "_" + EscapeJson(sym) + "\\""
                  + ",\\"name\\":\\"" + botName + "\\""
                  + ",\\"symbol\\":\\"" + EscapeJson(sym) + "\\""
                  + ",\\"timeframe\\":\\"" + EnumTimeframeLabel(_Period) + "\\""
                  + ",\\"magicNumber\\":" + IntegerToString((long)magic)
                  + ",\\"status\\":\\"" + (posJson != "null" ? "Posicionado" : "Monitorando") + "\\""
                  + ",\\"position\\":" + posJson
                  + ",\\"candles\\":" + candlesJson
                  + ",\\"candlesByTimeframe\\":" + tfMapJson
                  + ",\\"trades\\":" + tradesJson
                  + ",\\"historyTrades\\":" + histJson
                  + ",\\"markers\\":" + markersJson
                  + ",\\"realizedPnlBrl\\":" + DoubleToString(dailyRealized, 2)
                  + ",\\"floatingPnlBrl\\":" + DoubleToString(floatingPnlTotal, 2)
                  + ",\\"dailyPnlBrl\\":" + DoubleToString(botDailyPnl, 2) + "}";
      validRobots++;
   }

   robotsJson += "]";
   if(validRobots == 0) return;

   long accMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modeStr = (accMode == ACCOUNT_TRADE_MODE_REAL) ? "REAL" : "DEMO";
   string accJson = StringFormat(
      "{\\"login\\":\\"%I64d\\",\\"server\\":\\"%s\\",\\"broker\\":\\"%s\\",\\"mode\\":\\"%s\\",\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"dailyPnlBrl\\":%.2f}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJson(AccountInfoString(ACCOUNT_SERVER)),
      EscapeJson(AccountInfoString(ACCOUNT_COMPANY)),
      modeStr,
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      totalAccountDailyPnl
   );

   string payload = "{\\"replaceAll\\":" + (InpTodosAtivos ? "true" : "false")
                  + ",\\"account\\":" + accJson
                  + ",\\"robots\\":" + robotsJson + "}";

   char postData[];
   int len = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(postData, len - 1);

   char result[];
   string resultHeaders;
   string headers = "Content-Type: application/json\\r\\nx-sync-token: " + InpSyncToken + "\\r\\n";

   ResetLastError();
   int res = WebRequest("POST", InpEndpointUrl, headers, 5000, postData, result, resultHeaders);
   if(res == -1)
   {
      int err = GetLastError();
      g_conectadoLogado = false;
      if(err == 4060 || err == 4014)
         Print("PainelSync: Libere a URL em Ferramentas -> Opcoes -> Expert Advisors -> Permitir WebRequest: ", InpEndpointUrl);
      else
         Print("PainelSync erro WebRequest (", err, ") ao conectar em: ", InpEndpointUrl);
   }
   else if(res == 200)
   {
      if(!g_conectadoLogado)
      {
         Print("PainelSync: Sincronizado com sucesso! Robos: ", validRobots, " | Candles: ", totalChartCandles);
         g_conectadoLogado = true;
      }
   }
   else
   {
      g_conectadoLogado = false;
      string respBody = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      Print("PainelSync HTTP ", res, ": ", StringSubstr(respBody, 0, 200));
   }
}
`;
}

export function aggregateCandles(m1Candles: LiveCandle[], factor: number): LiveCandle[] {
  if (factor <= 1) return m1Candles;
  const out: LiveCandle[] = [];
  for (let i = 0; i < m1Candles.length; i += factor) {
    const slice = m1Candles.slice(i, i + factor);
    if (slice.length === 0) continue;
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      vol += c.volume;
    }
    out.push({
      index: out.length,
      time: slice[0].time,
      timeLabel: slice[0].timeLabel,
      open: slice[0].open,
      high,
      low,
      close: slice[slice.length - 1].close,
      volume: vol,
    });
  }
  return out;
}


