////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ------------------------------------------- Parte 1 ---------------------------------------------------//
// ------------------------------------------- $parte1 = @' ----------------------------------------------//
////////////////////////////////////////////////////////////////////////////////////////////////////////////

//+------------------------------------------------------------------+
//|                                                  Painel_Sync.mq5 |
//|                               Copyright (c) 2026, Painel Sync    |
//+------------------------------------------------------------------+
#property copyright "Painel Sync"
#property version   "2.00"
#property strict

input string   InpEndpointUrl      = "http://127.0.0.1:3000";
input string   InpToken            = "tk_test_1234567890";
input int      InpMaxChartBars     = 1000;   // Quantidade maxima de barras enviadas ao grafico
input string   InpChannelId        = "ps_c9a2rn8qcr";
input int      InpSyncIntervalSec  = 2;
input int      InpHistoryBackfillDays = 90;  // Dias de historico retroativo enviados ao iniciar (0 = desativa)
input bool     InpIncludeManual    = true;
input bool     InpDebug            = false;

struct RobotSummary
{
   long     magic;
   string   robotId;
   string   name;
   string   symbol;
   bool     hasPosition;
   string   posJson;
   string   ordersJson;
   int      ordersCount;
   string   tradesJson;
   int      tradesCount;
   double   realizedPnl;
   double   floatingPnl;
};

datetime g_lastSymbolsReport = 0;

int OnInit()
{
   Print("PainelSync v2.0: Iniciando monitoramento da conta no canal ", InpChannelId, "...");

   if(!EventSetTimer(MathMax(1, InpSyncIntervalSec)))
   {
      Print("PainelSync: Falha ao configurar o Timer.");
      return(INIT_FAILED);
   }

   g_lastSymbolsReport = TimeCurrent();
   SendSymbolsReport();
   if(InpHistoryBackfillDays > 0)
      SyncHistoricalTrades(InpHistoryBackfillDays);
   SendAccountAndRobotsTelemetry();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick() {}

void OnTimer()
{
   FetchPendingRequest();
   SendAccountAndRobotsTelemetry();

   if(TimeCurrent() - g_lastSymbolsReport >= 60)
   {
      g_lastSymbolsReport = TimeCurrent();
      SendSymbolsReport();
   }
}

void SendAccountAndRobotsTelemetry()
{
   RobotSummary robots[];
   int robotCount = 0;

   int posTotal = PositionsTotal();
   for(int i = 0; i < posTotal; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      if(magic == 0 && !InpIncludeManual) continue;

      string symbol  = PositionGetString(POSITION_SYMBOL);
      string comment = PositionGetString(POSITION_COMMENT);
      int idx = EnsureRobotEntry(robots, robotCount, magic, symbol, comment);

      long posType     = PositionGetInteger(POSITION_TYPE);
      string side      = (posType == POSITION_TYPE_BUY) ? "COMPRA" : "VENDA";
      double volume    = PositionGetDouble(POSITION_VOLUME);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl        = PositionGetDouble(POSITION_SL);
      double tp        = PositionGetDouble(POSITION_TP);
      double profit    = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      datetime openDt  = (datetime)PositionGetInteger(POSITION_TIME);
      int digits       = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
      double ptsOpen   = (point > 0) ? ((posType == POSITION_TYPE_BUY ? (currPrice - openPrice) : (openPrice - currPrice)) / point) : 0.0;

      robots[idx].floatingPnl += profit;

      if(!robots[idx].hasPosition)
      {
         robots[idx].hasPosition = true;
         robots[idx].posJson = "{"
            + "\"id\":\"" + IntegerToString((long)ticket) + "\""
            + ",\"robotId\":\"" + robots[idx].robotId + "\""
            + ",\"robotName\":\"" + EscapeJson(robots[idx].name) + "\""
            + ",\"magicNumber\":" + IntegerToString(magic)
            + ",\"symbol\":\"" + symbol + "\""
            + ",\"side\":\"" + side + "\""
            + ",\"volume\":" + DoubleToString(volume, 2)
            + ",\"entryPrice\":" + DoubleToString(openPrice, digits)
            + ",\"currentPrice\":" + DoubleToString(currPrice, digits)
            + ",\"sl\":" + DoubleToString(sl, digits)
            + ",\"tp\":" + DoubleToString(tp, digits)
            + ",\"floatingPnlBrl\":" + DoubleToString(profit, 2)
            + ",\"openTime\":\"" + TimeToString(openDt, TIME_DATE|TIME_MINUTES) + "\""
            + ",\"pointsOpen\":" + DoubleToString(ptsOpen, 1)
            + "}";
      }
   }

   int ordTotal = OrdersTotal();
   for(int i = 0; i < ordTotal; i++)
   {
      ulong orderTicket = OrderGetTicket(i);
      if(orderTicket == 0) continue;

      long magic = OrderGetInteger(ORDER_MAGIC);
      if(magic == 0 && !InpIncludeManual) continue;

      string symbol  = OrderGetString(ORDER_SYMBOL);
      string comment = OrderGetString(ORDER_COMMENT);
      int idx = EnsureRobotEntry(robots, robotCount, magic, symbol, comment);

      long ordType     = OrderGetInteger(ORDER_TYPE);
      string side      = (ordType == ORDER_TYPE_BUY_LIMIT || ordType == ORDER_TYPE_BUY_STOP || ordType == ORDER_TYPE_BUY_STOP_LIMIT) ? "COMPRA" : "VENDA";
      string typeLabel = "ORDEM";
      if(ordType == ORDER_TYPE_BUY_LIMIT)       typeLabel = "BUY LIMIT";
      else if(ordType == ORDER_TYPE_SELL_LIMIT) typeLabel = "SELL LIMIT";
      else if(ordType == ORDER_TYPE_BUY_STOP)   typeLabel = "BUY STOP";
      else if(ordType == ORDER_TYPE_SELL_STOP)  typeLabel = "SELL STOP";

      double volume    = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double ordPrice  = OrderGetDouble(ORDER_PRICE_OPEN);
      double sl        = OrderGetDouble(ORDER_SL);
      double tp        = OrderGetDouble(ORDER_TP);
      int digits       = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

      string ordObj = "{"
         + "\"id\":\"" + IntegerToString((long)orderTicket) + "\""
         + ",\"robotId\":\"" + robots[idx].robotId + "\""
         + ",\"robotName\":\"" + EscapeJson(robots[idx].name) + "\""
         + ",\"magicNumber\":" + IntegerToString(magic)
         + ",\"symbol\":\"" + symbol + "\""
         + ",\"side\":\"" + side + "\""
         + ",\"orderType\":\"" + typeLabel + "\""
         + ",\"volume\":" + DoubleToString(volume, 2)
         + ",\"price\":" + DoubleToString(ordPrice, digits)
         + ",\"sl\":" + DoubleToString(sl, digits)
         + ",\"tp\":" + DoubleToString(tp, digits)
         + "}";

      if(robots[idx].ordersCount > 0)
         robots[idx].ordersJson += ",";
      robots[idx].ordersJson += ordObj;
      robots[idx].ordersCount++;
   }

   MqlDateTime dtNow;
   TimeToStruct(TimeCurrent(), dtNow);
   dtNow.hour = 0; dtNow.min = 0; dtNow.sec = 0;
   datetime startOfDay = StructToTime(dtNow);
   double totalDailyPnl = 0.0;

   if(HistorySelect(startOfDay, TimeCurrent()))
   {
      int dealsTotal = HistoryDealsTotal();
      for(int i = 0; i < dealsTotal; i++)
      {
         ulong dealTicket = HistoryDealGetTicket(i);
         if(dealTicket == 0) continue;

         long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
         if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY)
            continue;

         long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
         if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL)
            continue;

         long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
         if(magic == 0 && !InpIncludeManual) continue;

         string symbol  = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
         string comment = HistoryDealGetString(dealTicket, DEAL_COMMENT);
         int idx = EnsureRobotEntry(robots, robotCount, magic, symbol, comment);

         string side      = (dealType == DEAL_TYPE_SELL) ? "COMPRA" : "VENDA";
         double volume    = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
         double exitPrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
         double pnl       = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                          + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                          + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
         datetime exitDt  = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
         int digits       = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

         long posId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
         double entryPrice = exitPrice;
         datetime entryDt  = exitDt;
         FindEntryDealInfo(posId, dealTicket, entryPrice, entryDt);

         double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
         double pts   = (point > 0) ? ((side == "COMPRA" ? (exitPrice - entryPrice) : (entryPrice - exitPrice)) / point) : 0.0;

         robots[idx].realizedPnl += pnl;
         totalDailyPnl += pnl;

         string tradeObj = "{"
            + "\"id\":\"" + IntegerToString((long)dealTicket) + "\""
            + ",\"robotId\":\"" + robots[idx].robotId + "\""
            + ",\"robotName\":\"" + EscapeJson(robots[idx].name) + "\""
            + ",\"magicNumber\":" + IntegerToString(magic)
            + ",\"symbol\":\"" + symbol + "\""
            + ",\"side\":\"" + side + "\""
            + ",\"entryDate\":\"" + TimeToString(entryDt, TIME_DATE) + "\""
            + ",\"exitDate\":\"" + TimeToString(exitDt, TIME_DATE) + "\""
            + ",\"entryTime\":\"" + TimeToString(entryDt, TIME_MINUTES|TIME_SECONDS) + "\""
            + ",\"exitTime\":\"" + TimeToString(exitDt, TIME_MINUTES|TIME_SECONDS) + "\""
            + ",\"entryPrice\":" + DoubleToString(entryPrice, digits)
            + ",\"exitPrice\":" + DoubleToString(exitPrice, digits)
            + ",\"volume\":" + DoubleToString(volume, 2)
            + ",\"points\":" + DoubleToString(pts, 1)
            + ",\"pnlBrl\":" + DoubleToString(pnl, 2)
            + ",\"reason\":\"" + EscapeJson(comment != "" ? comment : "Fechamento MT5") + "\""
            + "}";

         if(robots[idx].tradesCount > 0)
            robots[idx].tradesJson += ",";
         robots[idx].tradesJson += tradeObj;
         robots[idx].tradesCount++;
      }
   }

//'@
//Set-Content -Path "Painel_Sync.mq5" -Value $parte1 -Encoding UTF8
//Write-Host "Parte 1 gravada com sucesso!" -ForegroundColor Green

////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ----------------------------- Parte 2 -----------------------------------------------------------------//
// ----------------------------- $parte2 = @' ------------------------------------------------------------//
////////////////////////////////////////////////////////////////////////////////////////////////////////////

   long login       = AccountInfoInteger(ACCOUNT_LOGIN);
   string server    = AccountInfoString(ACCOUNT_SERVER);
   string broker    = AccountInfoString(ACCOUNT_COMPANY);
   string modeStr   = (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL) ? "REAL" : "DEMO";
   long marginModeVal = AccountInfoInteger(ACCOUNT_MARGIN_MODE); string marginModeStr = (marginModeVal == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING || marginModeVal == 2) ? "HEDGE" : "NETTING";
   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin    = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMarg  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double totalFloat = equity - balance;

   string json = "{";
   json += "\"account\":{";
   json += "\"login\":\"" + IntegerToString(login) + "\"";
   json += ",\"server\":\"" + EscapeJson(server) + "\"";
   json += ",\"broker\":\"" + EscapeJson(broker) + "\"";
   json += ",\"mode\":\"" + modeStr + "\"";
   json += ",\"marginMode\":\"" + marginModeStr + "\"";
   json += ",\"balance\":" + DoubleToString(balance, 2);
   json += ",\"equity\":" + DoubleToString(equity, 2);
   json += ",\"margin\":" + DoubleToString(margin, 2);
   json += ",\"freeMargin\":" + DoubleToString(freeMarg, 2);
   json += ",\"dailyPnlBrl\":" + DoubleToString(totalDailyPnl + totalFloat, 2);
   json += "}";

   json += ",\"robots\":[";
   string nowStr = TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS);

   for(int i = 0; i < robotCount; i++)
   {
      if(i > 0) json += ",";
      double botDaily = robots[i].realizedPnl + robots[i].floatingPnl;
      string statusStr = robots[i].hasPosition ? "Posicionado" : "Monitorando";

      json += "{";
      json += "\"robotId\":\"" + robots[i].robotId + "\"";
      json += ",\"robotName\":\"" + EscapeJson(robots[i].name) + "\"";
      json += ",\"name\":\"" + EscapeJson(robots[i].name) + "\"";
      json += ",\"magicNumber\":" + IntegerToString(robots[i].magic);
      json += ",\"symbol\":\"" + robots[i].symbol + "\"";
      json += ",\"timeframe\":\"" + TimeframeToShortString(_Period) + "\"";
      json += ",\"status\":\"" + statusStr + "\"";
      json += ",\"lastUpdate\":\"" + nowStr + "\"";
      json += ",\"position\":" + (robots[i].hasPosition ? robots[i].posJson : "null");
      json += ",\"pendingOrders\":[" + robots[i].ordersJson + "]";
      json += ",\"candles\":[]";
      json += ",\"trades\":[" + robots[i].tradesJson + "]";
      json += ",\"realizedPnlBrl\":" + DoubleToString(robots[i].realizedPnl, 2);
      json += ",\"floatingPnlBrl\":" + DoubleToString(robots[i].floatingPnl, 2);
      json += ",\"dailyPnlBrl\":" + DoubleToString(botDaily, 2);
      json += "}";
   }
   json += "],\"activeContracts\":{";
   string roots[] = {"WDO", "WIN", "IND", "DOL", "BIT"};
   int acCount = 0;
   datetime nowTime = TimeCurrent();
   for(int r = 0; r < ArraySize(roots); r++)
   {
      string root = roots[r];
      string bestSym = "";
      datetime bestExp = 0;
      for(int j = 0; j < count; j++)
      {
         string s = added[j];
         if(StringLen(s) != 6 || StringSubstr(s, 0, 3) != root) continue;
         ushort mCh = StringGetCharacter(s, 3);
         ushort y1  = StringGetCharacter(s, 4);
         ushort y2  = StringGetCharacter(s, 5);
         if(mCh < 'F' || mCh > 'Z' || y1 < '0' || y1 > '9' || y2 < '0' || y2 > '9') continue;
         datetime exp = (datetime)SymbolInfoInteger(s, SYMBOL_EXPIRATION_TIME);
         if(exp <= 0) continue;
         MqlDateTime expDt;
         TimeToStruct(exp, expDt);
         int rollDays = (expDt.day_of_week == 1) ? 3 : 1; // 1 dia util antes do vencimento
         datetime rolloverLimit = exp - (datetime)(rollDays * 86400);
         if(rolloverLimit < nowTime) continue;
         if(bestSym == "" || exp < bestExp)
         {
            bestSym = s;
            bestExp = exp;
         }
      }
      if(bestSym != "")
      {
         if(acCount > 0) json += ",";
         json += "\"" + root + "\":\"" + EscapeJson(bestSym) + "\"";
         acCount++;
      }
   }
   json += "}}";

   if(InpDebug)
      Print("PainelSync [DEBUG] Telemetria: ", json);

   SendToServer(json);
}

int EnsureRobotEntry(RobotSummary &robots[], int &count, const long magic, const string symbol, const string comment)
{
   string rId = "mt5_magic_" + IntegerToString(magic);
   for(int i = 0; i < count; i++)
   {
      if(robots[i].robotId == rId)
      {
         if(robots[i].symbol == "" && symbol != "")
            robots[i].symbol = symbol;
         return i;
      }
   }

   ArrayResize(robots, count + 1);
   robots[count].magic       = magic;
   robots[count].robotId     = rId;
   robots[count].symbol      = symbol;
   robots[count].hasPosition = false;
   robots[count].posJson     = "null";
   robots[count].ordersJson  = "";
   robots[count].ordersCount = 0;
   robots[count].tradesJson  = "";
   robots[count].tradesCount = 0;
   robots[count].realizedPnl = 0.0;
   robots[count].floatingPnl = 0.0;

   if(magic == 0)
      robots[count].name = "Operacao Manual";
   else if(comment != "" && StringFind(comment, "[") != 0)
      robots[count].name = comment + " (#" + IntegerToString(magic) + ")";
   else
      robots[count].name = "Robo #" + IntegerToString(magic);

   count++;
   return count - 1;
}

void FindEntryDealInfo(const long posId, const ulong outTicket, double &entryPrice, datetime &entryDt)
{
   if(posId <= 0) return;
   int total = HistoryDealsTotal();
   double weightedSum = 0.0;
   double totalVol = 0.0;
   datetime firstDt = 0;

   for(int i = 0; i < total; i++)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0 || t == outTicket) continue;
      if(HistoryDealGetInteger(t, DEAL_POSITION_ID) == posId &&
         HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN)
      {
         double v = HistoryDealGetDouble(t, DEAL_VOLUME);
         double p = HistoryDealGetDouble(t, DEAL_PRICE);
         datetime dt = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
         if(v > 0)
         {
            weightedSum += p * v;
            totalVol += v;
            if(firstDt == 0 || dt < firstDt) firstDt = dt;
         }
      }
   }

   if(totalVol > 0.0)
   {
      entryPrice = weightedSum / totalVol;
      if(firstDt > 0) entryDt = firstDt;
   }
}

void FetchPendingRequest()
{
   string url = InpEndpointUrl + "/api/mt5-sync/" + InpChannelId + "/pending";
   string headers = "X-Sync-Token: " + InpToken + "\r\n";

   char data[];
   char result[];
   string resultHeaders = "";

   int res = WebRequest("GET", url, headers, 3000, data, result, resultHeaders);
   if(res != 200 || ArraySize(result) <= 0) return;

   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   // 1. Processa pedidos explÃ­citos da fila (Snapshot inicial de 1000 candles)
   int pos = StringFind(response, "\"requests\":[");
   if(pos >= 0)
   {
      pos += StringLen("\"requests\":[");
      int len = StringLen(response);

      while(pos < len)
      {
         int objStart = StringFind(response, "{", pos);
         int arrEnd   = StringFind(response, "]", pos);
         if(objStart < 0 || (arrEnd >= 0 && objStart > arrEnd)) break;

         int objEnd = StringFind(response, "}", objStart);
         if(objEnd < 0) break;

         string obj = StringSubstr(response, objStart, objEnd - objStart + 1);
         string reqSymbol    = ExtractJsonString(obj, "symbol");
         string reqTimeframe = ExtractJsonString(obj, "timeframe");
         string requestId    = ExtractJsonString(obj, "requestId");
         if(requestId == "") requestId = ExtractJsonString(obj, "id");

         if(reqSymbol != "")
         {
            ENUM_TIMEFRAMES tf = StringToTimeframe(reqTimeframe);
            SendCandlesData(reqSymbol, tf, requestId, InpMaxChartBars, false);
         }
         pos = objEnd + 1;
      }
   }

   // 2. Se houver um grÃ¡fico ativo em foco no painel, envia Delta incremental (apenas 2 velas)
   int focusPos = StringFind(response, "\"activeChart\":{");
   if(focusPos >= 0)
   {
      int focusEnd = StringFind(response, "}", focusPos);
      if(focusEnd > focusPos)
      {
         string focusObj = StringSubstr(response, focusPos, focusEnd - focusPos + 1);
         string focusSym = ExtractJsonString(focusObj, "symbol");
         string focusTf  = ExtractJsonString(focusObj, "timeframe");
         if(focusSym != "" && focusTf != "")
         {
            SendCandlesData(focusSym, StringToTimeframe(focusTf), "", 2, true);
         }
      }
   }
}

void SendCandlesData(const string symbol, const ENUM_TIMEFRAMES period, const string requestId, const int barsCount, const bool isDelta = false)
{
   // Verifica se o ativo jÃ¡ estava visÃ­vel na ObservaÃ§Ã£o do Mercado antes
   bool wasSelected = (bool)SymbolInfoInteger(symbol, SYMBOL_SELECT);

   if(!wasSelected)
   {
      if(!SymbolSelect(symbol, true)) return;
   }

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int total = CopyRates(symbol, period, 0, MathMax(2, barsCount), rates);

   // Se acabou de ser adicionado agora, dÃ¡ 250ms para a corretora entregar o histÃ³rico
   if(total <= 0 && !wasSelected)
   {
      Sleep(250);
      total = CopyRates(symbol, period, 0, MathMax(2, barsCount), rates);
   }

   // Se nÃ£o estava na ObservaÃ§Ã£o do Mercado antes, remove para nÃ£o poluir sua lista
   if(!wasSelected)
   {
      SymbolSelect(symbol, false);
   }

   if(total <= 0) return;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string json = "{";
   json += "\"isChartRequest\":true";
   if(isDelta)
      json += ",\"isChartDelta\":true";
   json += ",\"symbol\":\"" + symbol + "\"";
   if(requestId != "")
      json += ",\"requestId\":\"" + requestId + "\"";
   json += ",\"timeframe\":\"" + TimeframeToShortString(period) + "\"";
   json += ",\"candles\":[";

   for(int i = 0; i < total; i++)
   {
      if(i > 0) json += ",";
      json += "{\"time\":" + IntegerToString((long)rates[i].time)
            + ",\"timeLabel\":\"" + TimeToString(rates[i].time, TIME_DATE|TIME_MINUTES) + "\""
            + ",\"open\":" + DoubleToString(rates[i].open, digits)
            + ",\"high\":" + DoubleToString(rates[i].high, digits)
            + ",\"low\":" + DoubleToString(rates[i].low, digits)
            + ",\"close\":" + DoubleToString(rates[i].close, digits)
            + ",\"volume\":" + IntegerToString(rates[i].tick_volume)
            + "}";
   }
   json += "]}";
   SendToServer(json);
}

//+------------------------------------------------------------------+
//| Verifica se o ativo deve entrar no catÃ¡logo do painel            |
//+------------------------------------------------------------------+
bool IsRelevantSymbol(const string name)
{
   int len = StringLen(name);
   if(len < 4 || len > 10) return false;

   // Ignora contratos expirados ou sÃ©ries de opÃ§Ãµes muito longas
   long tradeMode = SymbolInfoInteger(name, SYMBOL_TRADE_MODE);
   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED) return false;

   // Garante todos os futuros B3 (WDO, WIN, DOL, IND, BIT, WSP, CCM, BGI, ICF, DI1) e sÃ©ries contÃ­nuas ($/@)
   if(StringFind(name, "WDO") == 0 || StringFind(name, "WIN") == 0 ||
      StringFind(name, "DOL") == 0 || StringFind(name, "IND") == 0 ||
      StringFind(name, "BIT") == 0 || StringFind(name, "WSP") == 0 ||
      StringFind(name, "CCM") == 0 || StringFind(name, "BGI") == 0 ||
      StringFind(name, "ICF") == 0 || StringFind(name, "DI1") == 0)
      return true;

   // AÃ§Ãµes Ã  vista, FIIs, ETFs e BDRs padrÃ£o B3 (ex: PETR4, VALE3, BOVA11, MXRF11, AAPL34)
   if(len == 5 || len == 6)
   {
      string suffix = StringSubstr(name, 4);
      if(suffix == "3" || suffix == "4" || suffix == "5" || suffix == "6" ||
         suffix == "11" || suffix == "34" || suffix == "35" || suffix == "39")
         return true;
   }

   return false;
}

//+------------------------------------------------------------------+
//| Envia lista completa de ativos relevantes + Market Watch         |
//+------------------------------------------------------------------+
void SendSymbolsReport()
{
   string added[];
   int count = 0;
   string json = "{\"symbols\":[";

   // 1. Primeiro inclui 100% dos ativos que estÃ£o no seu Market Watch
   int mwTotal = SymbolsTotal(true);
   for(int i = 0; i < mwTotal; i++)
   {
      string name = SymbolName(i, true);
      if(name == "") continue;

      if(count > 0) json += ",";
      json += "\"" + EscapeJson(name) + "\"";
      ArrayResize(added, count + 1);
      added[count] = name;
      count++;
   }

   // 2. Depois varre TODOS os ativos da corretora (sem corte em 5000) filtrando os negociÃ¡veis
   int allTotal = SymbolsTotal(false);
   for(int i = 0; i < allTotal; i++)
   {
      string name = SymbolName(i, false);
      if(name == "" || !IsRelevantSymbol(name)) continue;

      // Evita duplicar o que jÃ¡ veio do Market Watch
      bool exists = false;
      for(int j = 0; j < count; j++)
      {
         if(added[j] == name) { exists = true; break; }
      }
      if(exists) continue;

      if(count > 0) json += ",";
      json += "\"" + EscapeJson(name) + "\"";
      ArrayResize(added, count + 1);
      added[count] = name;
      count++;
   }

   json += "]}";

   if(InpDebug)
      Print("PainelSync [DEBUG] CatÃ¡logo enviado: ", count, " ativos relevantes.");

   SendToServer(json);
}


void SyncHistoricalTrades(const int daysBack)
{
   if(daysBack <= 0) return;

   datetime now = TimeCurrent();
   datetime globalFrom = now - (datetime)(daysBack * 86400);
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   int chunkSec = 15 * 86400; // Lotes de 15 dias para payload leve
   int totalImported = 0;

   Print("PainelSync: Iniciando importacao de historico retroativo (", daysBack, " dias)...");

   for(datetime chunkStart = globalFrom; chunkStart < now; chunkStart += chunkSec)
   {
      datetime chunkEnd = MathMin(chunkStart + chunkSec, now);
      // Seleciona 7 dias antes do bloco para capturar entradas (DEAL_ENTRY_IN) de operacoes multi-dia
      datetime selectFrom = chunkStart - (7 * 86400);

      if(!HistorySelect(selectFrom, chunkEnd))
         continue;

      int dealsTotal = HistoryDealsTotal();
      string tradesJson = "";
      int chunkCount = 0;

      for(int i = 0; i < dealsTotal; i++)
      {
         ulong dealTicket = HistoryDealGetTicket(i);
         if(dealTicket == 0) continue;

         datetime exitDt = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
         if(exitDt < chunkStart || exitDt > chunkEnd) continue;

         long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
         if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY) continue;

         long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
         if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

         long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
         if(magic == 0 && !InpIncludeManual) continue;

         string symbol  = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
         string comment = HistoryDealGetString(dealTicket, DEAL_COMMENT);
         string rId     = "mt5_magic_" + IntegerToString(magic);
         string rName   = (magic == 0) ? "Operacao Manual"
                        : ((comment != "" && StringFind(comment, "[") != 0) ? (comment + " (#" + IntegerToString(magic) + ")")
                        : ("Robo #" + IntegerToString(magic)));

         string side      = (dealType == DEAL_TYPE_SELL) ? "COMPRA" : "VENDA";
         double volume    = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
         double exitPrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
         double pnl       = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                          + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                          + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
         int digits       = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
         if(digits <= 0) digits = 2;

         long posId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
         double entryPrice = exitPrice;
         datetime entryDt  = exitDt;
         FindEntryDealInfo(posId, dealTicket, entryPrice, entryDt);

         double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
         double pts   = (point > 0) ? ((side == "COMPRA" ? (exitPrice - entryPrice) : (entryPrice - exitPrice)) / point) : 0.0;

         string tradeObj = "{"
            + "\"id\":\"" + IntegerToString((long)dealTicket) + "\""
            + ",\"robotId\":\"" + rId + "\""
            + ",\"robotName\":\"" + EscapeJson(rName) + "\""
            + ",\"magicNumber\":" + IntegerToString(magic)
            + ",\"symbol\":\"" + symbol + "\""
            + ",\"side\":\"" + side + "\""
            + ",\"entryDate\":\"" + TimeToString(entryDt, TIME_DATE) + "\""
            + ",\"exitDate\":\"" + TimeToString(exitDt, TIME_DATE) + "\""
            + ",\"entryTime\":\"" + TimeToString(entryDt, TIME_MINUTES|TIME_SECONDS) + "\""
            + ",\"exitTime\":\"" + TimeToString(exitDt, TIME_MINUTES|TIME_SECONDS) + "\""
            + ",\"entryPrice\":" + DoubleToString(entryPrice, digits)
            + ",\"exitPrice\":" + DoubleToString(exitPrice, digits)
            + ",\"volume\":" + DoubleToString(volume, 2)
            + ",\"points\":" + DoubleToString(pts, 1)
            + ",\"pnlBrl\":" + DoubleToString(pnl, 2)
            + ",\"reason\":\"" + EscapeJson(comment != "" ? comment : "Fechamento MT5") + "\""
            + "}";

         if(chunkCount > 0) tradesJson += ",";
         tradesJson += tradeObj;
         chunkCount++;
      }

      if(chunkCount > 0)
      {
         string payload = "{\"isHistorySync\":true,\"account\":{\"login\":\"" + IntegerToString(login) + "\"},\"trades\":[" + tradesJson + "]}";
         SendToServer(payload);
         totalImported += chunkCount;
         Sleep(80);
      }
   }

   Print("PainelSync: Importacao historica concluida (", totalImported, " operacoes processadas).");
}

void SendToServer(const string jsonPayload)
{
   string url = InpEndpointUrl + "/api/mt5-sync/" + InpChannelId;
   string headers = "Content-Type: application/json\r\nX-Sync-Token: " + InpToken + "\r\n";

   char data[];
   int len = StringToCharArray(jsonPayload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);

   char result[];
   string resultHeaders = "";

   ResetLastError();
   int res = WebRequest("POST", url, headers, 3000, data, result, resultHeaders);
   if(res == -1)
   {
      Print("PainelSync: Erro WebRequest (", GetLastError(), "). Libere ", InpEndpointUrl, " em Ferramentas > Opcoes > Expert Advisors.");
   }
   else if(res >= 400)
   {
      Print("PainelSync: HTTP ", res, " -> ", CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
   }
}

string EscapeJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   return s;
}

string ExtractJsonString(const string json, const string key)
{
   string pattern = "\"" + key + "\"";
   int pos = StringFind(json, pattern);
   if(pos == -1) return "";
   int start = pos + StringLen(pattern);
   int len = StringLen(json);
   while(start < len && StringGetCharacter(json, start) != ':') start++;
   start++;
   while(start < len && (StringGetCharacter(json, start) == ' ' || StringGetCharacter(json, start) == '"')) start++;
   int end = start;
   while(end < len && StringGetCharacter(json, end) != '"' && StringGetCharacter(json, end) != ',' && StringGetCharacter(json, end) != '}') end++;
   return StringSubstr(json, start, end - start);
}

ENUM_TIMEFRAMES StringToTimeframe(string tf)
{
   StringToUpper(tf);
   if(tf == "M1")  return PERIOD_M1;
   if(tf == "M2")  return PERIOD_M2;
   if(tf == "M3")  return PERIOD_M3;
   if(tf == "M5")  return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1")  return PERIOD_H1;
   if(tf == "H4")  return PERIOD_H4;
   if(tf == "D1")  return PERIOD_D1;
   return PERIOD_M5;
}

string TimeframeToShortString(ENUM_TIMEFRAMES period)
{
   switch(period)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M2:  return "M2";
      case PERIOD_M3:  return "M3";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";

////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ------------------------------------------- Parte 3 ---------------------------------------------------//
// ------------------------------------------- 
////////////////////////////////////////////////////////////////////////////////////////////////////////////

      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
      default:         return "M5";
   }
}
//'@
//Add-Content -Path "Painel_Sync.mq5" -Value $parte2 -Encoding UTF8
//Write-Host "Painel_Sync.mq5 finalizado com sucesso!" -ForegroundColor Green

