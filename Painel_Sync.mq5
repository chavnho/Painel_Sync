////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////

//+------------------------------------------------------------------+
//|                                                  Painel_Sync.mq5 |
//|                               Copyright (c) 2026, Painel Sync    |
//+------------------------------------------------------------------+
#property copyright "Painel Sync"
#property version   "2.00"
#property service

input group "=== 1. Conexao e Autenticacao ==="
input string          InpEndpointUrl         = "http://127.0.0.1:3000"; // URL do Servidor Painel Sync
input string          InpChannelId           = "ps_950f4jzchg";          // ID do Canal da Sessao
input string          InpToken               = "tk_4r7ay6gleb3jtko69d";    // Token de Autenticacao

input group "=== 2. Sincronizacao e Historico ==="
input int             InpSyncIntervalSec     = 2;                       // Intervalo de Envio (segundos)
input int             InpMaxChartBars        = 1000;                    // Maximo de Candles por Grafico
input int             InpHistoryBackfillDays = 90;                      // Dias de Historico Retroativo (0 = desativa)
input bool            InpIncludeManual       = true;                    // Incluir Operacoes Manuais (Magic = 0)
input ENUM_TIMEFRAMES InpDefaultTimeframe    = PERIOD_CURRENT;          // Timeframe Padrao (Service / sem grafico)

input group "=== 3. Logs na Aba Experts ==="
input bool            InpLogOrders           = true;                    // Logar Abertura/Cancelamento de Ordens
input bool            InpLogPositions        = true;                    // Logar Abertura/Fechamento de Posicoes
input bool            InpLogConnection       = true;                    // Logar Catalogo e Contratos Vigentes
input bool            InpLogServer           = false;                   // Logar Pedidos de Candles e HTTP
input bool            InpDebug               = false;                   // Modo Depuracao Detalhado

ulong g_prevPosTickets[];
string g_prevPosDesc[];
ulong g_prevOrdTickets[];
string g_prevOrdDesc[];
bool g_stateInitialized = false;
bool g_historySynced = false;
datetime g_lastHistoryRetry = 0;

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

void OnStart()
{
   Print("PainelSync Service v2.1-TICKS: Iniciando monitoramento em segundo plano no canal ", InpChannelId, "...");

   g_lastSymbolsReport = TimeCurrent();
   SendSymbolsReport();
   if(InpHistoryBackfillDays > 0)
      SyncHistoricalTrades(InpHistoryBackfillDays);
   SendAccountAndRobotsTelemetry();

   while(!IsStopped())
   {
      int waitMs = MathMax(1, InpSyncIntervalSec) * 1000;
      for(int elapsed = 0; elapsed < waitMs && !IsStopped(); elapsed += 200)
         Sleep(200);
      if(IsStopped()) break;

      if(!g_historySynced && InpHistoryBackfillDays > 0 && TimeCurrent() - g_lastHistoryRetry >= 30) { g_lastHistoryRetry = TimeCurrent(); SyncHistoricalTrades(InpHistoryBackfillDays); }
      LogAccountStateChanges();
      FetchPendingRequest();
      SendAccountAndRobotsTelemetry();

      if(TimeCurrent() - g_lastSymbolsReport >= 60)
      {
         g_lastSymbolsReport = TimeCurrent();
         SendSymbolsReport();
      }
   }
   CleanupTempSymbols("", 0);
   Print("PainelSync Service: Monitoramento encerrado.");
}

void LogAccountStateChanges()
{
   ulong currPosT[]; string currPosD[];
   int pTot = PositionsTotal();
   for(int i = 0; i < pTot; i++)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      long mg = PositionGetInteger(POSITION_MAGIC);
      if(mg == 0 && !InpIncludeManual) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "COMPRA" : "VENDA";
      string desc = side + " " + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + "x " + sym + " @ " + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), dg) + " (Magic #" + IntegerToString(mg) + ")";
      int n = ArraySize(currPosT); ArrayResize(currPosT, n + 1); ArrayResize(currPosD, n + 1);
      currPosT[n] = tk; currPosD[n] = desc;
      if(g_stateInitialized && InpLogPositions)
      {
         bool found = false;
         for(int k = 0; k < ArraySize(g_prevPosTickets); k++) if(g_prevPosTickets[k] == tk) { found = true; break; }
         if(!found) Print("PainelSync [POSICOES] Aberta: ", desc);
      }
   }
   if(g_stateInitialized && InpLogPositions)
   {
      for(int k = 0; k < ArraySize(g_prevPosTickets); k++)
      {
         bool stillOpen = false;
         for(int j = 0; j < ArraySize(currPosT); j++) if(currPosT[j] == g_prevPosTickets[k]) { stillOpen = true; break; }
         if(!stillOpen) Print("PainelSync [POSICOES] Encerrada: ", g_prevPosDesc[k]);
      }
   }
   ArrayFree(g_prevPosTickets); ArrayFree(g_prevPosDesc); if(ArraySize(currPosT) > 0) { ArrayCopy(g_prevPosTickets, currPosT); ArrayCopy(g_prevPosDesc, currPosD); }

   ulong currOrdT[]; string currOrdD[];
   int oTot = OrdersTotal();
   for(int i = 0; i < oTot; i++)
   {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      long mg = OrderGetInteger(ORDER_MAGIC);
      if(mg == 0 && !InpIncludeManual) continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      string desc = EnumToString((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE)) + " " + DoubleToString(OrderGetDouble(ORDER_VOLUME_CURRENT), 2) + "x " + sym + " @ " + DoubleToString(OrderGetDouble(ORDER_PRICE_OPEN), dg) + " (Magic #" + IntegerToString(mg) + ")";
      int n = ArraySize(currOrdT); ArrayResize(currOrdT, n + 1); ArrayResize(currOrdD, n + 1);
      currOrdT[n] = tk; currOrdD[n] = desc;
      if(g_stateInitialized && InpLogOrders)
      {
         bool found = false;
         for(int k = 0; k < ArraySize(g_prevOrdTickets); k++) if(g_prevOrdTickets[k] == tk) { found = true; break; }
         if(!found) Print("PainelSync [ORDENS] Criada: ", desc);
      }
   }
   if(g_stateInitialized && InpLogOrders)
   {
      for(int k = 0; k < ArraySize(g_prevOrdTickets); k++)
      {
         bool stillExists = false;
         for(int j = 0; j < ArraySize(currOrdT); j++) if(currOrdT[j] == g_prevOrdTickets[k]) { stillExists = true; break; }
         if(!stillExists) Print("PainelSync [ORDENS] Removida/Cancelada: ", g_prevOrdDesc[k]);
      }
   }
   ArrayFree(g_prevOrdTickets); ArrayFree(g_prevOrdDesc); if(ArraySize(currOrdT) > 0) { ArrayCopy(g_prevOrdTickets, currOrdT); ArrayCopy(g_prevOrdDesc, currOrdD); }
   g_stateInitialized = true;
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
      ENUM_TIMEFRAMES robotTf = (_Period != PERIOD_CURRENT) ? _Period : InpDefaultTimeframe;
      json += ",\"timeframe\":\"" + TimeframeToShortString(robotTf) + "\"";
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
   json += "]}";

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

void SendCommandAck(const string id, const bool ok, const ulong oTk, const ulong pTk, const uint rc, const string msg) {
   string u = InpEndpointUrl + "/api/mt5-sync/" + InpChannelId + "/commands/" + id + "/ack";
   string h = "Content-Type: application/json\r\nX-Sync-Token: " + InpToken + "\r\n";
   string m = msg; StringReplace(m, "\\", "/"); StringReplace(m, "\"", "'");
   string p = "{\"ok\":" + (ok ? "true" : "false") + ",\"orderTicket\":\"" + (oTk > 0 ? IntegerToString((long)oTk) : "") + "\",\"positionTicket\":\"" + (pTk > 0 ? IntegerToString((long)pTk) : "") + "\",\"retcode\":" + IntegerToString((int)rc) + ",\"message\":\"" + m + "\"}";
   char post[], res[]; string rH = "";
   int len = StringToCharArray(p, post, 0, WHOLE_ARRAY, CP_UTF8); if(len > 0) ArrayResize(post, len - 1);
   WebRequest("POST", u, h, 3000, post, res, rH);
}
bool ClosePosTk(const ulong tk, uint &rc, string &msg) {
   if(!PositionSelectByTicket(tk)) { rc = 10013; msg = "Nao encontrada"; return false; }
   string sym = PositionGetString(POSITION_SYMBOL); double vol = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE); long mg = PositionGetInteger(POSITION_MAGIC);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s);
   r.action = TRADE_ACTION_DEAL; r.position = tk; r.symbol = sym; r.volume = vol; r.magic = mg; r.deviation = 50; r.type_filling = ORDER_FILLING_RETURN;
   if(pt == POSITION_TYPE_BUY) { r.type = ORDER_TYPE_SELL; r.price = NormalizeDouble(SymbolInfoDouble(sym, SYMBOL_BID), dg); }
   else { r.type = ORDER_TYPE_BUY; r.price = NormalizeDouble(SymbolInfoDouble(sym, SYMBOL_ASK), dg); }
   bool ok = OrderSend(r, s);
   if(!ok || (s.retcode != TRADE_RETCODE_DONE && s.retcode != TRADE_RETCODE_PLACED && s.retcode != TRADE_RETCODE_DONE_PARTIAL)) { r.type_filling = ORDER_FILLING_IOC; ZeroMemory(s); ok = OrderSend(r, s); }
   rc = s.retcode; msg = s.comment;
   Print("PainelSync [CMD] Fechar #" + IntegerToString((long)tk) + " -> retcode=" + IntegerToString((int)rc) + " (" + msg + ")");
   return (ok && (s.retcode == TRADE_RETCODE_DONE || s.retcode == TRADE_RETCODE_PLACED || s.retcode == TRADE_RETCODE_DONE_PARTIAL));
}
void ExecuteRemoteCommand(const string obj) {
   string id = ExtractJsonString(obj, "id"), act = ExtractJsonString(obj, "action"), sym = ExtractJsonString(obj, "symbol"), side = ExtractJsonString(obj, "side");
   string mgS = ExtractJsonString(obj, "magicNumber"), ptS = ExtractJsonString(obj, "positionTicket"), otS = ExtractJsonString(obj, "orderTicket");
   string vS = ExtractJsonString(obj, "volume"), pS = ExtractJsonString(obj, "price"), slS = ExtractJsonString(obj, "sl"), tpS = ExtractJsonString(obj, "tp");
   long tMg = (mgS != "") ? StringToInteger(mgS) : -1;
   ulong tPos = (ptS != "") ? (ulong)StringToInteger(ptS) : 0, tOrd = (otS != "") ? (ulong)StringToInteger(otS) : 0;
   double vol = (vS != "") ? StringToDouble(vS) : 0.0, prc = (pS != "") ? StringToDouble(pS) : 0.0;
   double sl = (slS != "") ? StringToDouble(slS) : 0.0, tp = (tpS != "") ? StringToDouble(tpS) : 0.0;
   if(id == "" || act == "") return;
   Print("PainelSync [CMD] Recebido: " + act + " | Magic: " + IntegerToString((int)tMg) + " | Simbolo: " + sym);
   if(tMg == 0 && !InpIncludeManual && (act == "CLOSE_MAGIC" || act == "CANCEL_ORDERS")) { SendCommandAck(id, false, 0, 0, 10013, "Magic 0 desabilitado"); return; }
   if(act == "CLOSE_MAGIC") {
      if(tPos > 0) { uint rc = 0; string m = ""; bool ok = ClosePosTk(tPos, rc, m); SendCommandAck(id, ok, 0, tPos, rc, ok ? "Zerada" : m); return; }
      ulong tks[];
      for(int i = PositionsTotal() - 1; i >= 0; i--) { ulong tk = PositionGetTicket(i); if(tk == 0) continue; long pm = PositionGetInteger(POSITION_MAGIC); if(tMg >= 0 && pm != tMg) continue; if(tMg < 0 && pm == 0 && !InpIncludeManual) continue; if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue; int n = ArraySize(tks); ArrayResize(tks, n + 1); tks[n] = tk; }
      int c = 0, fail = 0; uint lrc = 10009; string lm = "Nenhuma posicao";
      for(int k = 0; k < ArraySize(tks); k++) { if(ClosePosTk(tks[k], lrc, lm)) c++; else fail++; }
      SendCommandAck(id, fail == 0, 0, 0, lrc, fail > 0 ? ("Zeradas: " + IntegerToString(c) + " | Falhas: " + IntegerToString(fail)) : (c > 0 ? ("Zeradas: " + IntegerToString(c)) : lm)); return;
   }
   if(act == "CANCEL_ORDERS") {
      ulong oks[]; int totOrd = OrdersTotal();
      for(int i = totOrd - 1; i >= 0; i--) { ulong ot = OrderGetTicket(i); if(ot == 0 || !OrderSelect(ot)) continue; long om = OrderGetInteger(ORDER_MAGIC); if(tMg >= 0 && om != tMg) continue; if(tMg < 0 && om == 0 && !InpIncludeManual) continue; if(sym != "" && OrderGetString(ORDER_SYMBOL) != sym) continue; int n = ArraySize(oks); ArrayResize(oks, n + 1); oks[n] = ot; }
      int c = 0, fail = 0; uint lrc = 10009; string lm = "Nenhuma ordem";
      for(int k = 0; k < ArraySize(oks); k++) { MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s); r.action = TRADE_ACTION_REMOVE; r.order = oks[k]; bool okR = OrderSend(r, s); lrc = s.retcode; lm = s.comment; if(okR && (lrc == TRADE_RETCODE_DONE || lrc == TRADE_RETCODE_PLACED)) c++; else fail++; }
      SendCommandAck(id, fail == 0, 0, 0, lrc, fail > 0 ? ("Canceladas: " + IntegerToString(c) + " | Falhas: " + IntegerToString(fail)) : (c > 0 ? ("Canceladas: " + IntegerToString(c)) : lm)); return;
   }
   if(act == "CLOSE_ALL") {
      ulong ap[]; for(int i = PositionsTotal() - 1; i >= 0; i--) { ulong tk = PositionGetTicket(i); if(tk == 0) continue; long pm = PositionGetInteger(POSITION_MAGIC); if(tMg >= 0 && pm != tMg) continue; if(tMg < 0 && pm == 0 && !InpIncludeManual) continue; if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue; int n = ArraySize(ap); ArrayResize(ap, n + 1); ap[n] = tk; }
      int c = 0, failP = 0; uint rc = 10009; string m = ""; for(int k = 0; k < ArraySize(ap); k++) { if(ClosePosTk(ap[k], rc, m)) c++; else failP++; }
      ulong ao[]; for(int i = OrdersTotal() - 1; i >= 0; i--) { ulong ot = OrderGetTicket(i); if(ot == 0 || !OrderSelect(ot)) continue; long om = OrderGetInteger(ORDER_MAGIC); if(tMg >= 0 && om != tMg) continue; if(tMg < 0 && om == 0 && !InpIncludeManual) continue; if(sym != "" && OrderGetString(ORDER_SYMBOL) != sym) continue; int n = ArraySize(ao); ArrayResize(ao, n + 1); ao[n] = ot; }
      int ca = 0, failO = 0; for(int k = 0; k < ArraySize(ao); k++) { MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s); r.action = TRADE_ACTION_REMOVE; r.order = ao[k]; bool okR = OrderSend(r, s); if(okR && (s.retcode == TRADE_RETCODE_DONE || s.retcode == TRADE_RETCODE_PLACED)) ca++; else { failO++; rc = s.retcode; m = s.comment; } }
      bool okAll = (failP == 0 && failO == 0);
      SendCommandAck(id, okAll, 0, 0, okAll ? 10009 : rc, "Zerado: " + IntegerToString(c) + " pos, " + IntegerToString(ca) + " ord" + (okAll ? "" : (" | Falhas: " + IntegerToString(failP + failO)))); return;
   }
   if(act == "MODIFY_SL_TP") {
      if(tPos > 0 && PositionSelectByTicket(tPos)) { string pSym = PositionGetString(POSITION_SYMBOL); int dg = (int)SymbolInfoInteger(pSym, SYMBOL_DIGITS); MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s); r.action = TRADE_ACTION_SLTP; r.position = tPos; r.symbol = pSym; r.sl = (sl > 0.0) ? NormalizeDouble(sl, dg) : 0.0; r.tp = (tp > 0.0) ? NormalizeDouble(tp, dg) : 0.0; bool ok = OrderSend(r, s); bool done = (ok && (s.retcode == TRADE_RETCODE_DONE || s.retcode == TRADE_RETCODE_PLACED)); SendCommandAck(id, done, 0, tPos, s.retcode, done ? "SL/TP atualizado" : s.comment); return; }
      if(tOrd > 0 && OrderSelect(tOrd)) { string oSym = OrderGetString(ORDER_SYMBOL); int dg = (int)SymbolInfoInteger(oSym, SYMBOL_DIGITS); MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s); r.action = TRADE_ACTION_MODIFY; r.order = tOrd; r.price = (prc > 0.0) ? NormalizeDouble(prc, dg) : OrderGetDouble(ORDER_PRICE_OPEN); r.sl = (sl > 0.0) ? NormalizeDouble(sl, dg) : 0.0; r.tp = (tp > 0.0) ? NormalizeDouble(tp, dg) : 0.0; bool ok = OrderSend(r, s); bool done = (ok && (s.retcode == TRADE_RETCODE_DONE || s.retcode == TRADE_RETCODE_PLACED)); SendCommandAck(id, done, tOrd, 0, s.retcode, done ? "Ordem modificada" : s.comment); return; }
      SendCommandAck(id, false, tOrd, tPos, 10013, "Nao encontrada"); return;
   }
   if(act == "OPEN_ORDER") {
      if(sym == "" || vol <= 0.0) { SendCommandAck(id, false, 0, 0, 10013, "Invalidos"); return; }
      SymbolSelect(sym, true); MqlTradeRequest r; MqlTradeResult s; ZeroMemory(r); ZeroMemory(s); int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      r.symbol = sym; r.volume = vol; r.magic = (tMg >= 0) ? tMg : 0; r.deviation = 50; r.type_filling = ORDER_FILLING_RETURN;
      if(sl > 0.0) r.sl = NormalizeDouble(sl, dg); if(tp > 0.0) r.tp = NormalizeDouble(tp, dg);
      if(prc <= 0.0) { r.action = TRADE_ACTION_DEAL; r.type = (side == "VENDA") ? ORDER_TYPE_SELL : ORDER_TYPE_BUY; r.price = NormalizeDouble(SymbolInfoDouble(sym, (side == "VENDA") ? SYMBOL_BID : SYMBOL_ASK), dg); }
      else { r.action = TRADE_ACTION_PENDING; r.type = (side == "VENDA") ? ORDER_TYPE_SELL_LIMIT : ORDER_TYPE_BUY_LIMIT; r.price = NormalizeDouble(prc, dg); }
      bool sent = OrderSend(r, s); bool ok = (sent && (s.retcode == TRADE_RETCODE_DONE || s.retcode == TRADE_RETCODE_PLACED || s.retcode == TRADE_RETCODE_DONE_PARTIAL));
      SendCommandAck(id, ok, s.order, s.deal, s.retcode, ok ? "Enviada" : s.comment);
   }
}

string g_tempSyms[];
int g_tempSymIdle[];

void TrackTempSymbol(const string sym)
{
   if(sym == "") return;
   int n = ArraySize(g_tempSyms);
   for(int i = 0; i < n; i++)
   {
      if(g_tempSyms[i] == sym)
      {
         g_tempSymIdle[i] = 0;
         return;
      }
   }
   ArrayResize(g_tempSyms, n + 1);
   ArrayResize(g_tempSymIdle, n + 1);
   g_tempSyms[n] = sym;
   g_tempSymIdle[n] = 0;
}

void CleanupTempSymbols(const string keepSym, const int minIdleCycles)
{
   for(int i = ArraySize(g_tempSyms) - 1; i >= 0; i--)
   {
      string s = g_tempSyms[i];
      if(s == keepSym)
      {
         g_tempSymIdle[i] = 0;
         continue;
      }
      g_tempSymIdle[i]++;
      if(g_tempSymIdle[i] >= minIdleCycles)
      {
         SymbolSelect(s, false);
         if(!(bool)SymbolInfoInteger(s, SYMBOL_SELECT))
         {
            int last = ArraySize(g_tempSyms) - 1;
            if(i < last)
            {
               g_tempSyms[i] = g_tempSyms[last];
               g_tempSymIdle[i] = g_tempSymIdle[last];
            }
            ArrayResize(g_tempSyms, last);
            ArrayResize(g_tempSymIdle, last);
         }
      }
   }
}
int FindJsonClosingDelim(const string src, const int startIdx, const ushort openCh, const ushort closeCh)
{
   int len = StringLen(src);
   if(startIdx < 0 || startIdx >= len || StringGetCharacter(src, startIdx) != openCh)
      return -1;
   int depth = 0;
   bool inString = false;
   bool escaped = false;
   for(int i = startIdx; i < len; i++)
   {
      ushort ch = StringGetCharacter(src, i);
      if(inString)
      {
         if(escaped) { escaped = false; continue; }
         if(ch == '\\') { escaped = true; continue; }
         if(ch == '"') { inString = false; }
         continue;
      }
      if(ch == '"') { inString = true; continue; }
      if(ch == openCh) depth++;
      else if(ch == closeCh)
      {
         depth--;
         if(depth == 0) return i;
      }
   }
   return -1;
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

   // 1. Processa fila de comandos remotos
   int cKey = StringFind(response, "\"commands\"");
   if(cKey >= 0)
   {
      int cArrStart = StringFind(response, "[", cKey);
      int cArrEnd   = (cArrStart >= 0) ? FindJsonClosingDelim(response, cArrStart, '[', ']') : -1;
      if(cArrStart >= 0 && cArrEnd > cArrStart)
      {
         int cP = cArrStart + 1;
         while(cP < cArrEnd)
         {
            int s1 = StringFind(response, "{", cP);
            if(s1 < 0 || s1 >= cArrEnd) break;
            int e1 = FindJsonClosingDelim(response, s1, '{', '}');
            if(e1 < 0 || e1 > cArrEnd) break;
            ExecuteRemoteCommand(StringSubstr(response, s1, e1 - s1 + 1));
            cP = e1 + 1;
         }
      }
   }

   // 2. Processa pedidos explicitos de candles
   int rKey = StringFind(response, "\"requests\"");
   if(rKey >= 0)
   {
      int rArrStart = StringFind(response, "[", rKey);
      int rArrEnd   = (rArrStart >= 0) ? FindJsonClosingDelim(response, rArrStart, '[', ']') : -1;
      if(rArrStart >= 0 && rArrEnd > rArrStart)
      {
         int pos = rArrStart + 1;
         while(pos < rArrEnd)
         {
            int objStart = StringFind(response, "{", pos);
            if(objStart < 0 || objStart >= rArrEnd) break;
            int objEnd = FindJsonClosingDelim(response, objStart, '{', '}');
            if(objEnd < 0 || objEnd > rArrEnd) break;

            string obj = StringSubstr(response, objStart, objEnd - objStart + 1);
            string reqSymbol    = ExtractJsonString(obj, "symbol");
            string reqTimeframe = ExtractJsonString(obj, "timeframe");
            string requestId    = ExtractJsonString(obj, "requestId");
            if(requestId == "") requestId = ExtractJsonString(obj, "id");

            if(reqSymbol != "")
            {
               string reqDate = ExtractJsonString(obj, "date");
               if(reqTimeframe == "TICKS")
               {
                  string reqFromH = ExtractJsonString(obj, "fromHour");
                  string reqToH   = ExtractJsonString(obj, "toHour");
                  Print("PainelSync [TICKS REQ] Pedido recebido -> symbol=", reqSymbol, " | date=", reqDate, " | janela=", (reqFromH != "" ? reqFromH : "ALL"), "-", (reqToH != "" ? reqToH : "ALL"), " | reqId=", requestId);
                  SendTicksData(reqSymbol, requestId, reqDate, reqFromH, reqToH);
               }
               else
               {
                  ENUM_TIMEFRAMES tf = StringToTimeframe(reqTimeframe);
                  SendCandlesData(reqSymbol, tf, requestId, InpMaxChartBars, false, reqDate);
               }
            }
            pos = objEnd + 1;
         }
      }
   }

   // 3. Se houver um grafico ativo em foco no painel, envia Delta incremental
   int focusPos = StringFind(response, "\"activeChart\"");
   bool hasFocus = false;
   if(focusPos >= 0)
   {
      int cPos = StringFind(response, ":", focusPos);
      int fStart = (cPos >= 0) ? StringFind(response, "{", cPos) : -1;
      int nPos = (cPos >= 0) ? StringFind(response, "null", cPos) : -1;
      if(fStart >= 0 && (nPos < 0 || fStart < nPos))
      {
         int fEnd = FindJsonClosingDelim(response, fStart, '{', '}');
         if(fEnd > fStart)
         {
            string fObj = StringSubstr(response, fStart, fEnd - fStart + 1);
            string fSym = ExtractJsonString(fObj, "symbol");
            string fTf  = ExtractJsonString(fObj, "timeframe");
            if(fSym != "" && fTf != "")
            {
               hasFocus = true;
               CleanupTempSymbols(fSym, 2);
               SendCandlesData(fSym, StringToTimeframe(fTf), "", 50, true);
            }
         }
      }
   }
   // 4. Alimenta candles dos robos gerenciados ativos no painel (watchSymbols)
   int wKey = StringFind(response, "\"watchSymbols\"");
   if(wKey >= 0)
   {
      int wArrStart = StringFind(response, "[", wKey);
      int wArrEnd   = (wArrStart >= 0) ? FindJsonClosingDelim(response, wArrStart, '[', ']') : -1;
      if(wArrStart >= 0 && wArrEnd > wArrStart)
      {
         int wPos = wArrStart + 1;
         while(wPos < wArrEnd)
         {
            int wObjStart = StringFind(response, "{", wPos);
            if(wObjStart < 0 || wObjStart >= wArrEnd) break;
            int wObjEnd = FindJsonClosingDelim(response, wObjStart, '{', '}');
            if(wObjEnd < 0 || wObjEnd > wArrEnd) break;
            string wObj = StringSubstr(response, wObjStart, wObjEnd - wObjStart + 1);
            string wSym = ExtractJsonString(wObj, "symbol");
            string wTf  = ExtractJsonString(wObj, "timeframe");
            if(wSym != "" && wTf != "")
            {
               TrackTempSymbol(wSym);
               SendCandlesData(wSym, StringToTimeframe(wTf), "", 80, true);
            }
            wPos = wObjEnd + 1;
         }
      }
   }

   if(!hasFocus && ArraySize(g_tempSyms) > 0)
   {
      CleanupTempSymbols("", 6);
   }
}

void FillGapsFromRealTicks(const string symbol, const ENUM_TIMEFRAMES period, MqlRates &rates[], int &total)
{
   int stepSec = PeriodSeconds(period);
   if(stepSec <= 0 || total < 2) return;
   bool hasGap = false;
   for(int i = 1; i < total; i++)
   {
      long diff = (long)(rates[i].time - rates[i - 1].time);
      if(diff > stepSec && diff < 36000) { hasGap = true; break; }
   }
   if(!hasGap) return;
   MqlRates rebuilt[];
   ArrayResize(rebuilt, 0, total + 128);
   int addedTotal = 0;
   for(int i = 0; i < total; i++)
   {
      if(i > 0)
      {
         long diff = (long)(rates[i].time - rates[i - 1].time);
         if(diff > stepSec && diff < 36000)
         {
            datetime fromSec = rates[i - 1].time + stepSec;
            datetime toSec = rates[i].time - 1;
            MqlTick ticks[];
            int tCount = CopyTicksRange(symbol, ticks, COPY_TICKS_TRADE, (ulong)fromSec * 1000, (ulong)toSec * 1000 + 999);
            if(tCount <= 0) { Sleep(200); tCount = CopyTicksRange(symbol, ticks, COPY_TICKS_TRADE, (ulong)fromSec * 1000, (ulong)toSec * 1000 + 999); }
            if(tCount <= 0) { Sleep(200); tCount = CopyTicksRange(symbol, ticks, COPY_TICKS_TRADE, (ulong)fromSec * 1000, (ulong)toSec * 1000 + 999); }
            if(tCount > 0)
            {
               datetime curBarTime = 0;
               MqlRates bar;
               ZeroMemory(bar);
               bool hasBar = false;
               for(int t = 0; t < tCount; t++)
               {
                  double px = ticks[t].last;
                  if(px <= 0.0) continue;
                  datetime bTime = (datetime)(ticks[t].time - (ticks[t].time % stepSec));
                  if(bTime < fromSec || bTime > toSec) continue;
                  if(!hasBar || bTime != curBarTime)
                  {
                     if(hasBar)
                     {
                        int n = ArraySize(rebuilt);
                        ArrayResize(rebuilt, n + 1, 64);
                        rebuilt[n] = bar;
                        addedTotal++;
                     }
                     curBarTime = bTime;
                     ZeroMemory(bar);
                     bar.time = bTime;
                     bar.open = px;
                     bar.high = px;
                     bar.low = px;
                     bar.close = px;
                     bar.tick_volume = 1;
                     bar.real_volume = (long)ticks[t].volume;
                     hasBar = true;
                  }
                  else
                  {
                     if(px > bar.high) bar.high = px;
                     if(px < bar.low) bar.low = px;
                     bar.close = px;
                     bar.tick_volume += 1;
                     bar.real_volume += (long)ticks[t].volume;
                  }
               }
               if(hasBar)
               {
                  int n = ArraySize(rebuilt);
                  ArrayResize(rebuilt, n + 1, 64);
                  rebuilt[n] = bar;
                  addedTotal++;
               }
            }
         }
      }
      int idx = ArraySize(rebuilt);
      ArrayResize(rebuilt, idx + 1, 64);
      rebuilt[idx] = rates[i];
   }
   if(addedTotal > 0)
   {
      ArrayCopy(rates, rebuilt);
      total = ArraySize(rates);
   }
}
int CopyAndRepairRates(const string symbol, const ENUM_TIMEFRAMES period, const int barsCount, const string targetDate, MqlRates &outRates[])
{
   int stepSec = PeriodSeconds(period);
   bool canBuildFromM1 = (period > PERIOD_M1 && stepSec > 60 && stepSec <= 14400 && (stepSec % 60) == 0);
   int mult = canBuildFromM1 ? (stepSec / 60) : 1;
   ENUM_TIMEFRAMES fetchTf = canBuildFromM1 ? PERIOD_M1 : period;
   int fetchCount = canBuildFromM1 ? MathMin(15000, barsCount * mult + mult) : barsCount;
   MqlRates raw[]; ArraySetAsSeries(raw, false);
   int total = 0;
   if(targetDate != "")
   {
      datetime dStart = StringToTime(targetDate + " 00:00:00");
      datetime dEnd   = StringToTime(targetDate + " 23:59:59");
      if(dStart > 0 && dEnd >= dStart) total = CopyRates(symbol, fetchTf, dStart, dEnd, raw);
   }
   else total = CopyRates(symbol, fetchTf, 0, fetchCount, raw);
   if(total <= 0) return 0;
   FillGapsFromRealTicks(symbol, fetchTf, raw, total);
   if(!canBuildFromM1)
   {
      ArrayFree(outRates); ArrayCopy(outRates, raw);
      return total;
   }
   ArrayResize(outRates, 0, (total / mult) + 16);
   datetime curBucket = 0;
   MqlRates agg; ZeroMemory(agg); bool hasAgg = false;
   for(int i = 0; i < total; i++)
   {
      datetime bucket = (datetime)(raw[i].time - (raw[i].time % stepSec));
      if(!hasAgg || bucket != curBucket)
      {
         if(hasAgg)
         {
            int n = ArraySize(outRates); ArrayResize(outRates, n + 1, 64);
            outRates[n] = agg;
         }
         curBucket = bucket;
         ZeroMemory(agg);
         agg.time = bucket;
         agg.open = raw[i].open;
         agg.high = raw[i].high;
         agg.low  = raw[i].low;
         agg.close = raw[i].close;
         agg.tick_volume = raw[i].tick_volume;
         agg.real_volume = raw[i].real_volume;
         hasAgg = true;
      }
      else
      {
         if(raw[i].high > agg.high) agg.high = raw[i].high;
         if(raw[i].low < agg.low) agg.low = raw[i].low;
         agg.close = raw[i].close;
         agg.tick_volume += raw[i].tick_volume;
         agg.real_volume += raw[i].real_volume;
      }
   }
   if(hasAgg)
   {
      int n = ArraySize(outRates); ArrayResize(outRates, n + 1, 64);
      outRates[n] = agg;
   }
   int aggTotal = ArraySize(outRates);
   if(targetDate == "" && aggTotal > barsCount)
   {
      MqlRates sliced[];
      ArrayCopy(sliced, outRates, 0, aggTotal - barsCount, barsCount);
      ArrayFree(outRates); ArrayCopy(outRates, sliced);
      aggTotal = barsCount;
   }
   return aggTotal;
}
void SendTicksData(const string symbol, const string requestId, const string targetDate, const string fromHour = "", const string toHour = "")
{
   bool wasSelected = (bool)SymbolInfoInteger(symbol, SYMBOL_SELECT);
   if(!wasSelected && !SymbolSelect(symbol, true))
   {
      Print("PainelSync [TICKS] Falha ao selecionar simbolo: ", symbol);
      return;
   }

   string useDate = (targetDate != "") ? targetDate : TimeToString(TimeCurrent(), TIME_DATE);
   StringReplace(useDate, "-", ".");
   string startClock = (fromHour != "") ? (fromHour + ":00:00") : "00:00:00";
   string endClock   = (toHour != "")   ? (toHour + ":59:59")   : "23:59:59";
   datetime dStart = StringToTime(useDate + " " + startClock);
   datetime dEnd   = StringToTime(useDate + " " + endClock);
   if(dStart <= 0 || dEnd <= dStart)
   {
      Print("PainelSync [TICKS] Janela invalida: ", useDate, " ", startClock, "-", endClock);
      return;
   }

   MqlTick ticks[];
   ArraySetAsSeries(ticks, false);
   ResetLastError();
   int total = CopyTicksRange(symbol, ticks, COPY_TICKS_TRADE, (ulong)dStart * 1000, (ulong)dEnd * 1000);
   if(total <= 0)
      total = CopyTicksRange(symbol, ticks, COPY_TICKS_ALL, (ulong)dStart * 1000, (ulong)dEnd * 1000);

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string json = "{\"token\":\"" + InpToken + "\""
               + ",\"channelId\":\"" + InpChannelId + "\""
               + ",\"symbol\":\"" + symbol + "\""
               + ",\"date\":\"" + targetDate + "\""
               + ",\"fromHour\":\"" + fromHour + "\"";
   if(requestId != "")
      json += ",\"requestId\":\"" + requestId + "\"";
   json += ",\"ticks\":[";

   long lastSec = -1;
   double lastPrice = -1;
   int emitted = 0;
   for(int i = 0; i < total; i++)
   {
      double p = (ticks[i].last > 0) ? ticks[i].last : ((ticks[i].bid > 0) ? ticks[i].bid : ticks[i].ask);
      if(p <= 0) continue;
      long sec = (long)(ticks[i].time_msc / 1000);
      if(sec == lastSec && MathAbs(p - lastPrice) < 1e-8) continue;
      lastSec = sec;
      lastPrice = p;
      if(emitted > 0) json += ",";
      json += "[" + IntegerToString((long)ticks[i].time_msc) + "," + DoubleToString(p, digits) + "," + IntegerToString((long)MathMax(1, (int)ticks[i].volume)) + "]";
      emitted++;
   }
   json += "]}";
   int httpCode = SendToTicksEndpoint(json);
   Print("PainelSync [TICKS] ", symbol, " (", useDate, " ", startClock, "-", endClock, ") -> brutos=", total, " | enviados=", emitted, " | HTTP=", httpCode, " | err=", GetLastError());
}

int SendToTicksEndpoint(const string jsonPayload)
{
   string url = InpEndpointUrl;
   int apiPos = StringFind(url, "/api/mt5-sync/");
   if(apiPos > 0)
      url = StringSubstr(url, 0, apiPos) + "/api/mt5-sync/" + InpChannelId + "/ticks";
   else
      url = url + "/api/mt5-sync/" + InpChannelId + "/ticks";
   char post[], result[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpToken + "\r\n";
   string resHeaders;
   ResetLastError();
   int len = StringToCharArray(jsonPayload, post, 0, StringLen(jsonPayload), CP_UTF8);
   if(len > 0 && post[len - 1] == 0) ArrayResize(post, len - 1);
   int code = WebRequest("POST", url, headers, 15000, post, result, resHeaders);
   string respPreview = (ArraySize(result) > 0) ? StringSubstr(CharArrayToString(result, 0, -1, CP_UTF8), 0, 140) : "(vazio)";
   Print("PainelSync [TICKS POST] URL=", url, " | bytes=", ArraySize(post), " | HTTP=", code, " | err=", GetLastError(), " | resp=", respPreview);
   return code;
}

void SendCandlesData(const string symbol, const ENUM_TIMEFRAMES period, const string requestId, const int barsCount, const bool isDelta = false, const string targetDate = "")
{
   // Verifica se o ativo jÃ¡ estava visÃ­vel na ObservaÃ§Ã£o do Mercado antes
   bool wasSelected = (bool)SymbolInfoInteger(symbol, SYMBOL_SELECT);

   if(!wasSelected)
   {
      if(!SymbolSelect(symbol, true)) return;
   }

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int total = 0;
   datetime dStart = 0;
   datetime dEnd = 0;
   total = CopyAndRepairRates(symbol, period, barsCount, targetDate, rates);
   if(total <= 0) return;
   {
      int stepSec = PeriodSeconds(period);
      string gapsLog = "";
      int gapCount = 0;
      for(int g = 1; g < total; g++)
      {
         long diff = (long)(rates[g].time - rates[g - 1].time);
         if(stepSec > 0 && diff > stepSec && diff < 36000)
         {
            gapCount++;
            if(gapsLog != "") gapsLog += " | ";
            gapsLog += TimeToString(rates[g - 1].time, TIME_DATE|TIME_MINUTES) + "->" + TimeToString(rates[g].time, TIME_DATE|TIME_MINUTES) + "(" + IntegerToString(diff) + "s)";
         }
      }
   }


   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double volMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   string json = "{";
   json += "\"isChartRequest\":true";
   if(tickSize > 0)
   {
      json += ",\"tickSize\":" + DoubleToString(tickSize, 8) + ",\"digits\":" + IntegerToString(digits);
      if(volMin > 0) json += ",\"volumeMin\":" + DoubleToString(volMin, 4);
      if(volMax > 0) json += ",\"volumeMax\":" + DoubleToString(volMax, 4);
      if(volStep > 0) json += ",\"volumeStep\":" + DoubleToString(volStep, 4);
   }
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

   // AÃ§Ãµes Ã  vista, FIIs, ETFs e BDRs padrÃ£o B3 (ex: PETR4, VALE3, BOVA11, MXRF11, AAPL34)
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
   string specsJson = "";
   int specsCount = 0;
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

      double ts = SymbolInfoDouble(name, SYMBOL_TRADE_TICK_SIZE);
      int dg = (int)SymbolInfoInteger(name, SYMBOL_DIGITS);
      if(ts > 0)
      {
         if(specsCount > 0) specsJson += ",";
         double vMin = SymbolInfoDouble(name, SYMBOL_VOLUME_MIN);
         double vMax = SymbolInfoDouble(name, SYMBOL_VOLUME_MAX);
         double vStep = SymbolInfoDouble(name, SYMBOL_VOLUME_STEP);
         specsJson += "\"" + EscapeJson(name) + "\":{\"tickSize\":" + DoubleToString(ts, 8) + ",\"digits\":" + IntegerToString(dg);
         if(vMin > 0) specsJson += ",\"volumeMin\":" + DoubleToString(vMin, 4);
         if(vMax > 0) specsJson += ",\"volumeMax\":" + DoubleToString(vMax, 4);
         if(vStep > 0) specsJson += ",\"volumeStep\":" + DoubleToString(vStep, 4);
         specsJson += "}";
         specsCount++;
      }
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

   json += "],\"activeContracts\":{";
   string roots[] = {"WDO", "WIN", "IND", "DOL", "BIT"};
   int acCount = 0;
   datetime nowTime = TimeCurrent();
   string acSummary = "";
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
         int rollDays = (expDt.day_of_week == 1) ? 3 : 1;
         datetime rolloverLimit = exp - (datetime)(rollDays * 86400);
         if(rolloverLimit < nowTime) continue;
         if(bestSym == "" || exp < bestExp) { bestSym = s; bestExp = exp; }
      }
      if(bestSym != "")
      {
         if(acCount > 0) { json += ","; acSummary += " | "; }
         json += "\"" + root + "\":\"" + EscapeJson(bestSym) + "\"";
         acSummary += root + "->" + bestSym;
         acCount++;
      }
   }
   json += "}}";
   if(InpLogConnection)
      Print("PainelSync [CONEXAO] Catalogo: ", count, " ativos | Vigentes: ", (acSummary != "" ? acSummary : "nenhum"));

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

   g_historySynced = true;
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
   else if(InpLogServer)
   {
      Print("PainelSync [HTTP] POST telemetria -> status=", res, " (", ArraySize(data), " bytes)");
   }
   if(res >= 400)
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
   if(tf == "D1" || tf == "D")   return PERIOD_D1;
   if(tf == "W1" || tf == "W")   return PERIOD_W1;
   if(tf == "MN1" || tf == "M")  return PERIOD_MN1;
   return PERIOD_M5;
}

string TimeframeToShortString(ENUM_TIMEFRAMES period)
{
   switch(period)
   {
      case PERIOD_CURRENT: return "";
      case PERIOD_M1:  return "M1";
      case PERIOD_M2:  return "M2";
      case PERIOD_M3:  return "M3";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";

////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ------------------------------------------- 
////////////////////////////////////////////////////////////////////////////////////////////////////////////

      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
      case PERIOD_W1:  return "W1";
      case PERIOD_MN1: return "MN1";
      default:         return "M5";
   }
}
//'@
//Add-Content -Path "Painel_Sync.mq5" -Value $parte2 -Encoding UTF8
//Write-Host "Painel_Sync.mq5 finalizado com sucesso!" -ForegroundColor Green

