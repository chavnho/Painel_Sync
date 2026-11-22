<#
.SYNOPSIS
    Testa o fluxo JSON da API do Painel Sync (MT5 <-> servidor).

.DESCRIPTION
    Executa, em sequencia:
      1. Registro do canal (ping)
      2. POST simulando o EA enviando candles
      3. GET /candles (leitura do JSON gravado)
      4. POST /request (cria pedido)
      5. GET /pending (entrega o pedido ao EA)

.EXAMPLE
    .\teste-api.ps1
    .\teste-api.ps1 -ChannelId "ps_c9a2rn8qcr" -Token "tk_test_1234567890"
    .\teste-api.ps1 -BaseUrl "http://127.0.0.1:3000" -Symbol "EURUSD" -Timeframe "H1"
#>
[CmdletBinding()]
param(
    [string]$BaseUrl   = "http://127.0.0.1:3000",
    [string]$ChannelId = "ps_950f4jzchg",
    [string]$Token     = "tk_4r7ay6gleb3jtko69d",
    [string]$Symbol    = 'WDO$',
    [string]$Timeframe = "M5"
)

$ErrorActionPreference = "Stop"

$base    = "$BaseUrl/api/mt5-sync/$ChannelId"
$headers = @{ "x-sync-token" = $Token }

function Write-Step([string]$title) {
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Cyan
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        [string]$Body
    )
    try {
        if ($Body) {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType "application/json" -Body $Body -TimeoutSec 10
        }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -TimeoutSec 10
    }
    catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        Write-Host "ERRO HTTP $status em $Method $Uri" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        throw
    }
}

Write-Host "Painel Sync - Teste de API" -ForegroundColor Green
Write-Host "Base URL : $BaseUrl"
Write-Host "Canal    : $ChannelId"
Write-Host "Ativo/TF : $Symbol / $Timeframe"

# 1) Registro do canal -------------------------------------------------------
Write-Step "1) Registrar canal (ping)"
$ping = Invoke-Api -Method "POST" -Uri $base -Body '{"pingTest":true}'
$ping | ConvertTo-Json -Depth 6

# 2) POST simulando o EA -----------------------------------------------------
Write-Step "2) POST simulando o EA (candles)"
$payload = @'
{
  "symbol": "__SYMBOL__",
  "magicNumber": 12345,
  "robotName": "Robot Demo",
  "timeframe": "__TIMEFRAME__",
  "candles": [
    {"time":1795310000,"timeLabel":"2026.11.21 10:00","open":120000.0,"high":120500.0,"low":119800.0,"close":120300.0,"volume":1500},
    {"time":1795310300,"timeLabel":"2026.11.21 10:05","open":120300.0,"high":120900.0,"low":120100.0,"close":120700.0,"volume":1320}
  ],
  "positions": [],
  "trades": [],
  "realizedPnlBrl": 0.0,
  "floatingPnlBrl": 0.0,
  "dailyPnlBrl": 0.0
}
'@
$payload = $payload.Replace("__SYMBOL__", $Symbol).Replace("__TIMEFRAME__", $Timeframe)
$post = Invoke-Api -Method "POST" -Uri $base -Body $payload
$post | ConvertTo-Json -Depth 6

# 3) GET /candles ------------------------------------------------------------
Write-Step "3) GET /candles (leitura do JSON gravado)"
$encodedSymbol = [uri]::EscapeDataString($Symbol)
$candles = Invoke-Api -Method "GET" -Uri "$base/candles?symbol=$encodedSymbol&timeframe=$Timeframe"
$candles | ConvertTo-Json -Depth 8

# 4) POST /request -----------------------------------------------------------
Write-Step "4) Criar solicitacao (POST /request)"
$requestBody = @{ symbol = $Symbol; timeframe = $Timeframe } | ConvertTo-Json -Compress
$req = Invoke-Api -Method "POST" -Uri "$base/request" -Body $requestBody
$req | ConvertTo-Json -Depth 6

# 5) GET /pending ------------------------------------------------------------
Write-Step "5) GET /pending (entrega ao EA)"
$pending = Invoke-Api -Method "GET" -Uri "$base/pending"
$pending | ConvertTo-Json -Depth 6

Write-Host ""
Write-Host "Teste concluido." -ForegroundColor Green
