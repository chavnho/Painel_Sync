  //+------------------------------------------------------------------+
  //|                                               PainelSync_Gen.mq5 |
  //|                               Copyright © 2024, Painel Sync Team |
  //|                                           https://painelsync.com |
  //+------------------------------------------------------------------+
  #property copyright "Copyright © 2024, Painel Sync Team"
  #property link      "https://painelsync.com"
  #property version   "1.01"

  //--- Inputs
  input int      InpMagicNumber = 12345;
  input string   InpRobotName   = "Robot Demo";
  input string   InpEndpointUrl = "http://127.0.0.1:3000";
  input string   InpToken       = "tk_test_1234567890";
  input string   InpChannelId   = "ps_c9a2rn8qcr"; // ID do Canal
  input bool     InpDebug       = true;            // Exibir logs detalhados de depuração

  //--- Global Variables
  string g_endpointUrl = "";
  string g_token       = "";
  string g_channelId   = "";

  //+------------------------------------------------------------------+
  //| Expert initialization function                                   |
  //+------------------------------------------------------------------+
  int OnInit()
  {
     g_endpointUrl = InpEndpointUrl;
     g_token       = InpToken;
     g_channelId   = InpChannelId;

     Print("PainelSync: Iniciando no canal ", g_channelId, "...");
     if(InpDebug)
     {
        Print("PainelSync [DEBUG] Endpoint: ", g_endpointUrl);
        Print("PainelSync [DEBUG] Token: ", (StringLen(g_token) > 8 ? StringSubstr(g_token, 0, 4) + "***" + StringSubstr(g_token, StringLen(g_token) - 4) : g_token));
     }

     if(!EventSetTimer(2))
     {
        Print("PainelSync: Falha ao configurar o Timer.");
        return(INIT_FAILED);
     }

     return(INIT_SUCCEEDED);
  }

  //+------------------------------------------------------------------+
  //| Expert deinitialization function                                 |
  //+------------------------------------------------------------------+
  void OnDeinit(const int reason)
  {
     EventKillTimer();
     Print("PainelSync: Finalizado.");
  }

  //+------------------------------------------------------------------+
  //| Expert tick function                                             |
  //+------------------------------------------------------------------+
  void OnTick()
  {
     // O sincronismo ocorre no OnTimer() para não travar a thread de ticks
  }

  //+------------------------------------------------------------------+
  //| Timer function (roda a cada 2 segundos)                          |
  //+------------------------------------------------------------------+
  void OnTimer()
  {
     FetchPendingRequest();
  }

  //+------------------------------------------------------------------+
  //| Busca requisições pendentes no backend via GET                   |
  //+------------------------------------------------------------------+
  void FetchPendingRequest()
  {
     string url = g_endpointUrl + "/api/mt5-sync/" + g_channelId + "/pending";
     string headers = "X-Sync-Token: " + g_token + "\r\n";

     char data[];
     char result[];
     string resultHeaders = "";

     ResetLastError();
     int res = WebRequest("GET", url, headers, 3000, data, result, resultHeaders);

     if(res == -1)
     {
        int err = GetLastError();
        Print("PainelSync: Erro no WebRequest GET (", err, "). Verifique se ", g_endpointUrl, " está permitida no MT5 (Ctrl+O).");
        return;
     }

     string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

     if(InpDebug)
        Print("PainelSync [DEBUG] GET /pending -> HTTP ", res, " | Body: ", response);

     if(res != 200)
     {
        Print("PainelSync: /pending retornou HTTP ", res, " - ", response);
        return;
     }

     if(ArraySize(result) <= 0)
     {
        if(InpDebug)
           Print("PainelSync [DEBUG] Resposta vazia do servidor.");
        return;
     }

     string reqSymbol    = ExtractJsonString(response, "symbol");
     string reqTimeframe = ExtractJsonString(response, "timeframe");
     string requestId    = ExtractJsonString(response, "requestId");
     if(requestId == "")
        requestId = ExtractJsonString(response, "id");

     if(reqSymbol == "")
     {
        if(InpDebug)
           Print("PainelSync [DEBUG] Nenhuma solicitação pendente.");
        return;
     }

     ProcessPendingRequests(response);
  }

  //+------------------------------------------------------------------+
  //| Processa todos os pedidos do array "requests" da resposta        |
  //+------------------------------------------------------------------+
  void ProcessPendingRequests(const string response)
  {
     int pos = StringFind(response, "\"requests\":[");
     if(pos < 0)
     {
        if(InpDebug)
           Print("PainelSync [DEBUG] Campo 'requests' não encontrado na resposta.");
        return;
     }

     pos += StringLen("\"requests\":[");
     int len = StringLen(response);
     int processed = 0;

     while(pos < len)
     {
        int objStart = StringFind(response, "{", pos);
        if(objStart < 0) break;

        int objEnd = StringFind(response, "}", objStart);
        if(objEnd < 0) break;

        string obj = StringSubstr(response, objStart, objEnd - objStart + 1);

        string reqSymbol    = ExtractJsonString(obj, "symbol");
        string reqTimeframe = ExtractJsonString(obj, "timeframe");
        string requestId    = ExtractJsonString(obj, "requestId");
        if(requestId == "")
           requestId = ExtractJsonString(obj, "id");

        if(reqSymbol != "")
        {
           ENUM_TIMEFRAMES tf = StringToTimeframe(reqTimeframe);
           Print("PainelSync: Pedido recebido do painel -> Ativo: ", reqSymbol, " | TF: ", EnumToString(tf), " | ID: ", requestId);
           SendSyncData(reqSymbol, tf, requestId);
           processed++;
        }

        pos = objEnd + 1;
     }

     if(processed == 0 && InpDebug)
        Print("PainelSync [DEBUG] Nenhuma solicitação pendente.");
  }

  //+------------------------------------------------------------------+
  //| Coleta candles de qualquer ativo e envia para o servidor         |
  //+------------------------------------------------------------------+
  void SendSyncData(const string symbol, const ENUM_TIMEFRAMES period, const string requestId)
  {
     if(!SymbolSelect(symbol, true))
     {
        Print("PainelSync: Ativo não encontrado na corretora: ", symbol);
        return;
     }

     MqlRates rates[];
     ArraySetAsSeries(rates, false);

     int total = CopyRates(symbol, period, 0, 100, rates);
     if(total <= 0)
     {
        Print("PainelSync: Aguardando histórico de ", symbol, " (", EnumToString(period), ")...");
        return;
     }

     string payload = BuildPayload(symbol, period, rates, total, requestId);
     if(payload == "")
        return;

     // LOG DE DEPURAÇÃO: Mostra o JSON exato no terminal do MetaTrader
     Print("PainelSync [DEBUG] Enviando Payload: ", payload);

     SendToServer(payload);
  }

  //+------------------------------------------------------------------+
  //| Envia o payload JSON gerado para o backend via POST              |
  //+------------------------------------------------------------------+
  void SendToServer(const string jsonPayload)
  {
     string url = g_endpointUrl + "/api/mt5-sync/" + g_channelId;
     string headers = "Content-Type: application/json\r\n" +
                      "X-Sync-Token: " + g_token + "\r\n";

     char data[];
     int len = StringToCharArray(jsonPayload, data, 0, WHOLE_ARRAY, CP_UTF8);
     if(len > 0)
        ArrayResize(data, len - 1);

     char result[];
     string resultHeaders = "";

     ResetLastError();
     int res = WebRequest("POST", url, headers, 3000, data, result, resultHeaders);

     if(res == -1)
     {
        int err = GetLastError();
        Print("PainelSync: Erro ao enviar payload (", err, ").");
        return;
     }

     if(res >= 200 && res < 300)
     {
        Print("PainelSync: Payload enviado com sucesso (HTTP ", res, ").");
     }
     else
     {
        string errBody = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
        Print("PainelSync: Servidor retornou HTTP ", res, " - ", errBody);
     }
  }

  //+------------------------------------------------------------------+
  //| Monta o payload JSON válido com candles, posições e PnL          |
  //+------------------------------------------------------------------+
  string BuildPayload(const string symbol, const ENUM_TIMEFRAMES period, const MqlRates &rates[], const int total, const
  string requestId)
  {
     int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

     string json = "{";
     json += "\"symbol\":\"" + symbol + "\"";
     if(requestId != "")
        json += ",\"requestId\":\"" + requestId + "\"";

     json += ",\"magicNumber\":" + IntegerToString(InpMagicNumber);
     json += ",\"robotName\":\"" + InpRobotName + "\"";
     json += ",\"timeframe\":\"" + TimeframeToShortString(period) + "\"";
     json += ",\"status\":\"Monitorando\"";
     json += ",\"lastUpdate\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES) + "\"";
     json += ",\"candles\":[";

     for(int i = 0; i < total; i++)
     {
        if(i > 0) json += ",";
        json += "{";
        json += "\"time\":" + IntegerToString((long)rates[i].time);
        json += ",\"timeLabel\":\"" + TimeToString(rates[i].time, TIME_DATE | TIME_MINUTES) + "\"";
        json += ",\"open\":" + DoubleToString(rates[i].open, digits);
        json += ",\"high\":" + DoubleToString(rates[i].high, digits);
        json += ",\"low\":" + DoubleToString(rates[i].low, digits);
        json += ",\"close\":" + DoubleToString(rates[i].close, digits);
        json += ",\"volume\":" + IntegerToString(rates[i].tick_volume);
        json += "}";
     }

     json += "],";
     json += "\"positions\":[],";
     json += "\"trades\":[],";
     json += "\"realizedPnlBrl\":0.0,";
     json += "\"floatingPnlBrl\":0.0,";
     json += "\"dailyPnlBrl\":0.0";
     json += "}";

     return json;
  }

  //+------------------------------------------------------------------+
  //| Extrai o valor de uma chave string de um JSON simples            |
  //+------------------------------------------------------------------+
  string ExtractJsonString(const string json, const string key)
  {
     string pattern = "\"" + key + "\"";
     int pos = StringFind(json, pattern);
     if(pos == -1) return "";

     int start = pos + StringLen(pattern);
     int len = StringLen(json);

     // Pula espaços até o caractere ':' e depois até o início do valor
     while(start < len && StringGetCharacter(json, start) != ':')
     {
        ushort c = StringGetCharacter(json, start);
        if(c != ' ' && c != '\t' && c != '\r' && c != '\n')
           return "";
        start++;
     }
     if(start >= len) return "";
     start++; // pula ':'

     while(start < len)
     {
        ushort c = StringGetCharacter(json, start);
        if(c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '"')
           start++;
        else
           break;
     }

     int end = start;
     while(end < len && StringGetCharacter(json, end) != '"' && StringGetCharacter(json, end) != ',' &&
           StringGetCharacter(json, end) != '}')
        end++;

     string val = StringSubstr(json, start, end - start);
     StringTrimLeft(val);
     StringTrimRight(val);
     if(val == "null" || val == "false") return "";
     return val;
  }

  //+------------------------------------------------------------------+
  //| Converte string ("M5", "PERIOD_M5", "H1") para ENUM_TIMEFRAMES   |
  //+------------------------------------------------------------------+
  ENUM_TIMEFRAMES StringToTimeframe(string tf)
  {
     StringToUpper(tf);
     StringReplace(tf, "PERIOD_", "");

     if(tf == "M1")  return PERIOD_M1;
     if(tf == "M2")  return PERIOD_M2;
     if(tf == "M3")  return PERIOD_M3;
     if(tf == "M5")  return PERIOD_M5;
     if(tf == "M10") return PERIOD_M10;
     if(tf == "M15") return PERIOD_M15;
     if(tf == "M30") return PERIOD_M30;
     if(tf == "H1")  return PERIOD_H1;
     if(tf == "H2")  return PERIOD_H2;
     if(tf == "H4")  return PERIOD_H4;
     if(tf == "D1")  return PERIOD_D1;
     if(tf == "W1")  return PERIOD_W1;
     if(tf == "MN1") return PERIOD_MN1;

     return _Period;
  }

  //+------------------------------------------------------------------+
  //| Converte ENUM_TIMEFRAMES para formato curto ("M5", "H1", etc.)   |
  //+------------------------------------------------------------------+
  string TimeframeToShortString(const ENUM_TIMEFRAMES tf)
  {
     string s = EnumToString(tf);
     StringReplace(s, "PERIOD_", "");
     return s;
  }