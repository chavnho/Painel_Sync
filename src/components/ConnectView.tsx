import React from 'react';
import { Check, Copy, Info, Trash2 } from 'lucide-react';
import type { DashboardTelemetry, PairingAttemptEvent } from '../types/trading';
import { buildPainelSyncMql5 } from '../utils/mt5Bridge';

interface ConnectViewProps {
  streamStatus: 'connecting' | 'listening' | 'error';
  telemetry: DashboardTelemetry | null;
  pairingEvents: PairingAttemptEvent[];
  onClearSession: () => void;
  creds: { channelId: string; token: string };
}
export function ConnectView({ streamStatus, telemetry, pairingEvents, onClearSession, creds }: ConnectViewProps) {
  const [copiedField, setCopiedField] = React.useState<'channelId' | 'token' | 'endpoint' | 'eaCode' | null>(null);
  const [mqlMode, setMqlMode] = React.useState<'ea' | 'service'>('ea');
  const [logFilter, setLogFilter] = React.useState<'all' | 'orders' | 'positions' | 'connection' | 'server'>('all');
  const inferCat = (ev: PairingAttemptEvent) => ev.category ?? (ev.source === 'ping' ? 'connection' : ev.source === 'mt5' ? 'connection' : 'server');
  const filteredLogs = React.useMemo(() => logFilter === 'all' ? pairingEvents : pairingEvents.filter((ev) => inferCat(ev) === logFilter), [pairingEvents, logFilter]);
  const endpointUrl = window.location.origin;

  const eaCode = React.useMemo(() => buildPainelSyncMql5({ endpointUrl, token: creds.token, channelId: creds.channelId, mode: mqlMode }), [endpointUrl, creds.token, creds.channelId, mqlMode]);

  const copyValue = async (field: 'channelId' | 'token' | 'endpoint' | 'eaCode', value: string) => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
    }
  };
  const statusColor = { connecting: 'text-blue-400', listening: 'text-emerald-400', error: 'text-red-400' } as const;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-[#090D12] text-gray-100">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold">Configuração do Robô EA</h2>
            <p className="text-gray-400 text-sm">Use as credenciais abaixo para configurar seu robô no MetaTrader 5.</p>
          </div>
          {telemetry && (
            <button type="button" onClick={onClearSession} title="Limpar dados recebidos na sessão atual" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161D27] hover:bg-[#2A191E] border border-[#1E2633] hover:border-red-500/40 text-xs font-medium text-gray-300 hover:text-red-300 transition-colors cursor-pointer shrink-0">
              <Trash2 className="w-3.5 h-3.5" /><span>Limpar Sessão</span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl bg-[#0F141C] border border-[#1E2633] space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Dados de Conexão</h3>
            <div className="space-y-2">
              {[
                { key: 'endpoint' as const, label: 'Endpoint:', val: endpointUrl },
                { key: 'channelId' as const, label: 'Channel ID:', val: creds.channelId },
                { key: 'token' as const, label: 'Auth Token:', val: creds.token },
              ].map((item) => (
                <div key={item.key} className="flex justify-between items-center gap-2">
                  <span className="text-gray-500 text-xs">{item.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-emerald-400 text-xs font-mono truncate">{item.val}</code>
                    <button type="button" onClick={() => copyValue(item.key, item.val)} title={`Copiar ${item.label}`} className="p-1 hover:bg-[#1A222D] rounded transition-colors text-gray-400 hover:text-emerald-400 shrink-0 cursor-pointer">
                      {copiedField === item.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>Tipo de Execução no MT5</span>
                <span className="font-mono text-gray-500">{mqlMode === 'service' ? 'MQL5\\Services\\' : 'MQL5\\Experts\\'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 bg-[#090D12] p-1 rounded-lg border border-[#1E2633]">
                <button type="button" onClick={() => setMqlMode('ea')} className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${mqlMode === 'ea' ? 'bg-[#1F2937] text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}>Expert Advisor (Gráfico)</button>
                <button type="button" onClick={() => setMqlMode('service')} className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${mqlMode === 'service' ? 'bg-[#1F2937] text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}>Serviço (2º Plano)</button>
              </div>
            </div>
            <button type="button" onClick={() => copyValue('eaCode', eaCode)} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer">
              {copiedField === 'eaCode' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedField === 'eaCode' ? 'Código copiado!' : mqlMode === 'service' ? 'Copiar código do Serviço (Painel_Sync.mq5)' : 'Copiar código do EA (Painel_Sync.mq5)'}
            </button>
          </div>
          <div className="p-6 rounded-xl bg-[#0F141C] border border-[#1E2633] flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Status do Stream</h3>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${streamStatus === 'listening' ? 'bg-emerald-500 animate-pulse' : streamStatus === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} />
                  <span className={`text-xs font-mono font-bold ${statusColor[streamStatus]}`}>{streamStatus.toUpperCase()}</span>
                </div>
              </div>
              <div className="divide-y divide-[#1E2633] text-xs [&>div]:py-2 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0">
                <div className="flex justify-between"><span className="text-gray-400">Canal Ativo:</span><span className="font-mono text-gray-200">{creds.channelId}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Última Recepção:</span><span className="font-mono text-gray-200">{telemetry?.serverReceivedAt ? new Date(telemetry.serverReceivedAt).toLocaleTimeString('pt-BR') : 'Aguardando EA'}</span></div>
              </div>
            </div>
            <div className="pt-2 border-t border-[#1E2633]">
              <p className="text-[11px] text-gray-500 mb-1">Endpoint Stream SSE:</p>
              <code className="block p-2 bg-[#090D12] rounded border border-[#1E2633] break-all text-[10px] text-emerald-400">{`${endpointUrl}/api/mt5-sync/${creds.channelId}/stream?token=${creds.token}`}</code>
            </div>
          </div>
        </div>
        <div className="p-6 rounded-xl bg-[#0F141C] border border-[#1E2633] space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Info className="w-5 h-5 text-gray-400" />Conta MT5</h2>
          {telemetry?.account ? (
            <div className="divide-y divide-[#1E2633] text-sm [&>div]:py-2 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0">
              {(telemetry.account.broker || telemetry.account.server) && (<div className="flex justify-between gap-4"><span className="text-gray-400">Servidor:</span><span className="font-mono text-gray-200 truncate">{telemetry.account.server || telemetry.account.broker}</span></div>)}
              <div className="flex justify-between"><span className="text-gray-400">Tipo:</span><span className={`font-mono font-bold px-1.5 py-0.5 rounded text-xs ${telemetry.account.mode === 'REAL' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-amber-950/60 text-amber-400 border border-amber-800/50'}`}>{telemetry.account.mode}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Modo:</span><span className="font-mono font-semibold px-1.5 py-0.5 rounded text-xs bg-[#161D27] text-gray-200 border border-[#1E2633]">{telemetry.account.marginMode ?? 'NETTING'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Conta:</span><span className="font-mono text-gray-200">{telemetry.account.login}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Margem Disponível:</span><span className="font-mono font-semibold text-gray-100">R$ {(telemetry.account.freeMargin ?? telemetry.account.equity ?? telemetry.account.balance).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
              {telemetry.account.margin > 0 && (<div className="flex justify-between"><span className="text-gray-400">Margem Retida:</span><span className="font-mono text-amber-400">R$ {telemetry.account.margin.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>)}
            </div>
          ) : (<div className="text-sm text-gray-500 italic">Aguardando dados da conta...</div>)}
        </div>
        <div className="p-6 rounded-xl bg-[#0F141C] border border-[#1E2633]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold">Log de Eventos & Pareamento</h2>
            <div className="flex flex-wrap items-center gap-1 bg-[#090D12] p-1 rounded-lg border border-[#1E2633]">
              {([['all','Todos'],['orders','Ordens'],['positions','Posições'],['connection','Conexão'],['server','Servidor']] as const).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setLogFilter(k)} className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${logFilter === k ? 'bg-[#1F2937] text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {filteredLogs.length === 0 ? (<p className="text-sm text-gray-500">Nenhum evento registrado.</p>) : (
              filteredLogs.map((ev) => (
                <div key={ev.id} className={`p-3 rounded border text-xs flex justify-between items-start ${ev.outcome === 'success' ? 'border-emerald-900/50 bg-emerald-900/10' : ev.outcome === 'error' ? 'border-red-900/50 bg-red-900/10' : 'border-[#1E2633] bg-[#090D12]'}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><span className="font-bold uppercase">{ev.source}</span><span className="text-gray-500">|</span><span className="text-gray-300">{ev.summary}</span></div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">{ev.detail}</p>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">{new Date(ev.timestamp).toLocaleTimeString('pt-BR')}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
