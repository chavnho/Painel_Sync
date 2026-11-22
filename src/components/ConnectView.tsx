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
  }[streamStatus];

  const statusIcon = {
    connecting: <Activity className="w-5 h-5 animate-pulse" />,
    listening: <CheckCircle2 className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
  }[streamStatus];

  return (
    <div className="flex-1 flex flex-col p-8 space-y-8 bg-[#0B0E11] text-gray-100">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Status da Conexão</h1>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${statusColor} border-current`}>
            {statusIcon}
            <span className="text-sm font-medium capitalize">{streamStatus}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Conexão de Dados */}
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

          {/* Informações da Conta */}
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
