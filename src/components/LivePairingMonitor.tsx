import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  Mt5SyncCredentials,
  PairingAttemptEvent,
  RobotStream,
} from '../types/trading';

interface LivePairingMonitorProps {
  creds: Mt5SyncCredentials;
  streamStatus: 'connecting' | 'listening' | 'error';
  pairingEvents: PairingAttemptEvent[];
  robots: RobotStream[];
  lastSyncAt: string | null;
  onClearPairingLog: () => void;
  compact?: boolean;
}

type ProbeState =
  | { status: 'checking' }
  | { status: 'reachable'; httpStatus: number; checkedAt: string }
  | { status: 'blocked'; reason: string; checkedAt: string };

const SOURCE_LABELS: Record<PairingAttemptEvent['source'], string> = {
  mt5: 'MT5',
  ping: 'Teste Canal',
  backend: 'Servidor',
  frontend: 'Painel',
  unknown: 'Externo',
};

export function LivePairingMonitor({
  creds,
  streamStatus,
  pairingEvents,
  robots,
  lastSyncAt,
  onClearPairingLog,
  compact = false,
}: LivePairingMonitorProps) {
  const [probe, setProbe] = useState<ProbeState>({ status: 'checking' });
  const [isSendingPing, setIsSendingPing] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'orders' | 'positions' | 'connection' | 'server'>('all');
  const inferCat = (ev: PairingAttemptEvent) => ev.category ?? (ev.source === 'ping' || ev.source === 'mt5' ? 'connection' : 'server');

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : '';

  const runExternalProbe = useCallback(async () => {
    setProbe({ status: 'checking' });
    const checkedAt = new Date().toLocaleTimeString('pt-BR');
    try {
      const res = await fetch(
        `/api/mt5-sync/${encodeURIComponent(creds.channelId)}/probe`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          cache: 'no-store',
        }
      );

      if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 301) {
        setProbe({
          status: 'blocked',
          checkedAt,
          reason:
            'Esta URL privada exige login no navegador (redirecionamento 302). O MetaTrader 5 sem cookies receberá HTTP 302/401 ao tentar enviar dados para este endereço.',
        });
        return;
      }

      if (res.status === 401 || res.status === 403) {
        setProbe({
          status: 'blocked',
          checkedAt,
          reason: `Acesso externo sem cookies bloqueado com HTTP ${res.status}. Utilize uma URL pública ou servidor local para o WebRequest do MT5.`,
        });
        return;
      }

      if (!res.ok) {
        setProbe({
          status: 'blocked',
          checkedAt,
          reason: `O endpoint respondeu HTTP ${res.status} para requisições sem cookies.`,
        });
        return;
      }

      const data = (await res.json()) as { ok?: boolean };
      if (data?.ok) {
        setProbe({ status: 'reachable', httpStatus: res.status, checkedAt });
      } else {
        setProbe({
          status: 'blocked',
          checkedAt,
          reason: 'Resposta inesperada do servidor ao testar acesso sem cookies.',
        });
      }
    } catch {
      setProbe({
        status: 'blocked',
        checkedAt,
        reason:
          'Bloqueio de autenticação ou rede para requisições externas sem cookies nesta URL de preview.',
      });
    }
  }, [creds.channelId]);

  useEffect(() => {
    runExternalProbe();
  }, [runExternalProbe]);

  const handleSendPingTest = useCallback(async () => {
    setIsSendingPing(true);
    try {
      await fetch(`/api/mt5-sync/${encodeURIComponent(creds.channelId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-token': creds.token,
        },
        body: JSON.stringify({ pingTest: true }),
      });
    } catch {
      // erro de rede visível se SSE cair
    } finally {
      setIsSendingPing(false);
    }
  }, [creds.channelId, creds.token]);

  const hasLiveMt5 = robots.length > 0;
  const latestEvent = pairingEvents[0] ?? null;
  const visibleEvents = compact ? pairingEvents.slice(0, 6) : pairingEvents;

  return (
    <section
      aria-label="Monitor de Pareamento em Tempo Real"
      className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden"
    >
      {/* Cabeçalho do Monitor */}
      <div className="px-5 py-4 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-sm font-semibold text-gray-100">
            Pareamento em Tempo Real
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 font-mono tabular-nums">
            <span>Canal {creds.channelId}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                hasLiveMt5
                  ? 'text-emerald-400 font-medium'
                  : streamStatus === 'listening'
                    ? 'text-sky-300'
                    : streamStatus === 'error'
                      ? 'text-rose-400'
                      : 'text-gray-300'
              }
            >
              {hasLiveMt5
                ? `Sincronizado (${robots.length} robô${robots.length > 1 ? 's' : ''})`
                : streamStatus === 'listening'
                  ? 'Escutando requisições MT5'
                  : streamStatus === 'error'
                    ? 'Reconectando stream'
                    : 'Conectando stream'}
            </span>
            {lastSyncAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Último sinal {new Date(lastSyncAt).toLocaleTimeString('pt-BR')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSendPingTest}
            disabled={isSendingPing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A222D] hover:bg-[#232D3B] border border-[#2C3747] text-xs font-medium text-gray-100 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{isSendingPing ? 'Testando...' : 'Testar Canal Agora'}</span>
          </button>

          <button
            type="button"
            onClick={runExternalProbe}
            disabled={probe.status === 'checking'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#1E2633] text-xs font-medium text-gray-200 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-sky-300 shrink-0 ${
                probe.status === 'checking' ? 'animate-spin' : ''
              }`}
            />
            <span>Testar Alcance Externo</span>
          </button>

          {pairingEvents.length > 0 && (
            <button
              type="button"
              onClick={onClearPairingLog}
              title="Limpar histórico de pareamento"
              aria-label="Limpar histórico de pareamento"
              className="p-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#1E2633] text-gray-400 hover:text-gray-200 transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Diagnóstico de Alcance Externo (Cookies vs MT5 WebRequest) */}
      <div className="px-5 py-3 border-b border-[#1E2633] bg-[#090D12] flex items-start gap-3 text-xs">
        {probe.status === 'checking' ? (
          <>
            <Globe className="w-4 h-4 text-sky-300 shrink-0 mt-0.5" />
            <div className="text-gray-300">
              Verificando se esta URL aceita requisições externas sem cookies (como o WebRequest do MT5)...
            </div>
          </>
        ) : probe.status === 'reachable' ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-medium text-emerald-400">
                Alcance externo liberado (HTTP {probe.httpStatus}) · Verificado às {probe.checkedAt}
              </div>
              <p className="text-gray-400 leading-relaxed">
                Este endereço aceita conexões diretas do MetaTrader 5. Se ainda não houver eventos abaixo, libere{' '}
                <code className="font-mono text-gray-200">{originUrl}</code> em{' '}
                <strong className="text-gray-200">Ferramentas → Opções → Expert Advisors → WebRequest</strong> no MT5.
              </p>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-amber-400">
                Atenção: bloqueio externo detectado na URL atual · Verificado às {probe.checkedAt}
              </div>
              <p className="text-gray-400 leading-relaxed">
                {probe.reason}
              </p>
              <p className="text-gray-300 leading-relaxed">
                As URLs de preview/compartilhamento do AI Studio exigem sessão Google e não aceitam <code className="font-mono text-gray-200">POST</code> externo do MT5. Para conectar seu MetaTrader 5 real, baixe o projeto e rode localmente no PC/VPS do MT5 (<code className="font-mono text-emerald-300">npm install &amp;&amp; npm run dev</code> → <code className="font-mono text-sky-300">http://localhost:3000</code>) ou faça deploy em um Cloud Run/VPS público sem login obrigatório.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Filtros de Categoria do Log */}
      <div className="px-5 py-2 border-b border-[#1E2633] bg-[#0F141C] flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-gray-400">Filtrar eventos:</span>
        <div className="flex flex-wrap items-center gap-1 bg-[#090D12] p-0.5 rounded-lg border border-[#1E2633]">
          {([['all','Todos'],['orders','Ordens'],['positions','Posições'],['connection','Conexão'],['server','Servidor']] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setLogFilter(k)} className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${logFilter === k ? 'bg-[#1F2937] text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}>{lbl}</button>
          ))}
        </div>
      </div>
      {/* Lista de Eventos em Tempo Real */}
      {visibleEvents.length === 0 ? (
        <div className="px-5 py-8 text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-gray-300">
            <Clock className="w-4 h-4 text-gray-400" />
            <span>Aguardando a primeira tentativa de envio do MetaTrader 5</span>
          </div>
          <p className="text-xs text-gray-500 max-w-xl mx-auto leading-relaxed">
            Assim que o EA <code className="font-mono text-gray-400">PainelSync.mq5</code> no MetaTrader 5 fizer um <code className="font-mono text-gray-400">POST</code> para este canal, cada sucesso (HTTP 200) ou erro (400/401/403) aparecerá aqui instantaneamente.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#1E2633] max-h-72 overflow-y-auto">
          {visibleEvents.map((evt, index) => {
            const isSuccess = evt.outcome === 'success';
            const isError = evt.outcome === 'error';
            const isRequest = evt.outcome === 'request';
            const timeFormatted = new Date(evt.timestamp).toLocaleTimeString('pt-BR');

            return (
              <div
                key={evt.id}
                className={`px-5 py-3 flex items-start justify-between gap-4 text-xs ${
                  index === 0 ? 'bg-[#131922]' : ''
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : isError ? (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="w-4 h-4 text-sky-300 shrink-0 mt-0.5" />
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-semibold ${
                          isSuccess
                            ? 'text-emerald-400'
                            : isError
                              ? 'text-rose-400'
                              : 'text-sky-300'
                        }`}
                      >
                        {isSuccess ? 'Sucesso' : isError ? 'Erro' : isRequest ? 'Pedido' : 'Info'}
                      </span>
                      <span className="text-gray-200 font-medium">{evt.summary}</span>
                    </div>
                    <div className="text-gray-400 leading-relaxed break-words">
                      {evt.detail}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-right font-mono tabular-nums text-[11px] text-gray-400 space-y-0.5">
                  <div>
                    <span>{SOURCE_LABELS[evt.source] ?? 'Servidor'}</span>
                    <span aria-hidden="true"> · </span>
                    <span
                      className={
                        evt.httpStatus >= 200 && evt.httpStatus < 300
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      HTTP {evt.httpStatus}
                    </span>
                  </div>
                  <div className="text-gray-500">{timeFormatted}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rodapé discreto apenas quando já há último evento */}
      {latestEvent && (
        <div className="px-5 py-2.5 border-t border-[#1E2633] bg-[#090D12] flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 font-mono tabular-nums">
          <span>
            Último evento: {latestEvent.outcome === 'success' ? 'OK' : 'Falha'} (HTTP{' '}
            {latestEvent.httpStatus})
          </span>
          <span>
            Exibindo {visibleEvents.length} de {pairingEvents.length} registro(s)
          </span>
        </div>
      )}
    </section>
  );
}
