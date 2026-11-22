import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  WifiOff,
  Info
} from 'lucide-react';
import type {
  DashboardTelemetry,
  PairingAttemptEvent
} from '../types/trading';

interface ConnectViewProps {
  streamStatus: 'connecting' | 'listening' | 'error';
  telemetry: DashboardTelemetry | null;
  pairingEvents: PairingAttemptEvent[];
  creds: {
    channelId: string;
    token: string;
  };
}

export function ConnectView({
  streamStatus,
  telemetry,
  pairingEvents,
  creds
}: ConnectViewProps) {
  const statusColor = {
    connecting: 'text-blue-400',
    listening: 'text-emerald-400',
    error: 'text-red-400',
  } as const;

  const statusIcon = {
    connecting: <Activity className="w-5 h-5 animate-pulse" />,
    listening: <CheckCircle2 className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
  } as const;

  return (
    <div className="flex-1 flex flex-col p-8 space-y-8 bg-[#0B0E11] text-gray-100">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Configuração do Robô EA</h2>
          <p className="text-gray-400 text-sm">Use as credenciais abaixo para configurar seu robô no MetaTrader 5.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl bg-[#11161D] border border-[#222B38] space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Dados de Conexão</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-xs">Channel ID:</span>
                <code className="text-emerald-400 text-xs font-mono">{creds.channelId}</code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-xs">Auth Token:</span>
                <code className="text-emerald-400 text-xs font-mono">{creds.token}</code>
              </div>
            </div>
            <button
              onClick={() => {
                const text = `g_endpointUrl = "http://localhost:3000";\ng_token = "${creds.token}";\ng_channelId = "${creds.channelId}";`;
                navigator.clipboard.writeText(text);
                alert("Credenciais copiadas!");
              }}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold transition-colors"
            >
              Copiar Variáveis para o EA
            </button>
          </div>
          <div className="p-6 rounded-xl bg-[#11161D] border border-[#222B38]">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Status do Stream</h3>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${streamStatus === 'listening' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              <span className={`text-sm ${statusColor[streamStatus]}`}>{streamStatus.toUpperCase()}</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Conectado ao canal: <span className="text-gray-300">{creds.channelId}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl bg-[#11161D] border border-[#222B38] space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <WifiOff className="w-5 h-5 text-gray-400" />
              Detalhes do Stream
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Canal:</span>
                <span className="font-mono">{creds.channelId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status do SSE:</span>
                <span className="font-mono">{streamStatus}</span>
              </div>
              <div className="pt-4">
                <p className="text-xs text-gray-500 mb-1">URL de Conexão:</p>
                <code className="block p-2 bg-[#0B0E11] rounded border border-[#1E2633] break-all text-[10px] text-emerald-400">
                  {`wss://${window.location.hostname}/api/mt5-sync/${creds.channelId}/stream?token=${creds.token}`}
                </code>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl bg-[#11161D] border border-[#222B38] space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Info className="w-5 h-5 text-gray-400" />
              Conta MT5
            </h2>
            {telemetry?.account ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Login:</span>
                  <span className="font-mono">{telemetry.account.login}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Modo:</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 text-xs border border-emerald-800">
                    {telemetry.account.mode}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Saldo:</span>
                  <span className="font-mono">R$ {telemetry.account.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Equidade:</span>
                  <span className="font-mono">R$ {telemetry.account.equity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic">
                Aguardando dados da conta...
              </div>
            )}
          </div>
        </div>

        {/* Log de Eventos de Pareamento */}
        <div className="p-6 rounded-xl bg-[#11161D] border border-[#222B38]">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            Log de Pareamento
          </h2>
          <div className="space-y-2">
            {pairingEvents.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum evento registrado.</p>
            ) : (
              pairingEvents.map((ev) => (
                <div
                  key={ev.id}
                  className={`p-3 rounded border text-xs flex justify-between items-start ${
                    ev.outcome === 'success'
                      ? 'border-emerald-900/50 bg-emerald-900/10'
                      : ev.outcome === 'error'
                        ? 'border-red-900/50 bg-red-900/10'
                        : 'border-gray-800 bg-gray-800/10'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold uppercase">{ev.source}</span>
                      <span className="text-gray-500">|</span>
                      <span className="text-gray-300">{ev.summary}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      {ev.detail}
                    </p>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">
                    {ev.timestamp.split('T')[1].split('.')[0]}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
