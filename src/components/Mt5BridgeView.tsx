import { useMemo, useState } from 'react';
import { Check, Copy, Globe, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  Mt5SyncCredentials,
  PairingAttemptEvent,
  RobotStream,
} from '../types/trading';
import { buildPainelSyncMql5 } from '../utils/mt5Bridge';
import { LivePairingMonitor } from './LivePairingMonitor';

interface Mt5BridgeViewProps {
  creds: Mt5SyncCredentials;
  streamStatus: 'connecting' | 'listening' | 'error';
  pairingEvents: PairingAttemptEvent[];
  robots: RobotStream[];
  lastSyncAt: string | null;
  onClearPairingLog: () => void;
  onRegenerateToken: () => void;
}

export function Mt5BridgeView({
  creds,
  streamStatus,
  pairingEvents,
  robots,
  lastSyncAt,
  onClearPairingLog,
  onRegenerateToken,
}: Mt5BridgeViewProps) {
  const [magicInput, setMagicInput] = useState<number>(0);
  const [robotNameInput, setRobotNameInput] = useState<string>('Robo_MT5');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const originUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const endpointUrl = useMemo(() => {
    if (!originUrl) return `/api/mt5-sync/${creds.channelId}`;
    return `${originUrl}/api/mt5-sync/${creds.channelId}`;
  }, [originUrl, creds.channelId]);

  const mql5Code = useMemo(
    () =>
      buildPainelSyncMql5({
        endpointUrl,
        token: creds.token, channelId: creds.channelId,
        magicNumber: magicInput,
        robotName: robotNameInput,
      }),
    [endpointUrl, creds.token, magicInput, robotNameInput]
  );

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignora erro de permissão
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-xl font-bold text-gray-100">
              Conectar Terminal MetaTrader 5
            </h1>
            <p className="text-xs text-gray-400">
              Espelhamento em tempo real via POST + SSE e comandos remotos autenticados
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRegenerateToken}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161C25] hover:bg-[#1E2633] border border-[#1E2633] text-xs font-medium text-gray-200 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
              <span>Novo Token</span>
            </button>
          </div>
        </div>

        {/* Monitor de Pareamento em Tempo Real */}
        <LivePairingMonitor
          creds={creds}
          streamStatus={streamStatus}
          pairingEvents={pairingEvents}
          robots={robots}
          lastSyncAt={lastSyncAt}
          onClearPairingLog={onClearPairingLog}
        />

        {/* Aviso de Autentica??o e Comandos Remotos */}
        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] px-5 py-3.5 flex items-center gap-3 text-xs text-emerald-400">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>
            Seguran?a: al?m do espelhamento em tempo real, o conector aceita comandos remotos (encerrar posi??es, cancelar ordens e zerar conta) autenticados exclusivamente pelo Token do Canal. Mantenha seu token em sigilo.
          </span>
        </div>

        {/* Credenciais do Canal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>1. URL Base para WebRequest (MT5)</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-sky-300 truncate bg-[#090D12] px-3 py-2 rounded-lg border border-[#1E2633]">
                {originUrl || endpointUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('origin', originUrl || endpointUrl)}
                className="px-3 py-2 rounded-lg bg-[#1A222D] hover:bg-[#232D3B] border border-[#2C3747] text-xs text-gray-100 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copiedKey === 'origin' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'origin' ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 space-y-2">
            <div className="text-xs font-medium text-gray-400">
              2. Endpoint Completo (InpEndpointUrl)
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-sky-300 truncate bg-[#090D12] px-3 py-2 rounded-lg border border-[#1E2633]">
                {endpointUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('url', endpointUrl)}
                className="px-3 py-2 rounded-lg bg-[#1A222D] hover:bg-[#232D3B] border border-[#2C3747] text-xs text-gray-100 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copiedKey === 'url' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'url' ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>3. Token de Pareamento (InpSyncToken)</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-emerald-300 truncate bg-[#090D12] px-3 py-2 rounded-lg border border-[#1E2633]">
                {creds.token}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('token', creds.token)}
                className="px-3 py-2 rounded-lg bg-[#1A222D] hover:bg-[#232D3B] border border-[#2C3747] text-xs text-gray-100 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copiedKey === 'token' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'token' ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Conector EA MQL5 */}
        <div className="rounded-xl bg-[#0F141C] border border-[#1E2633] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2633] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                Expert Advisor MQL5 (PainelSync.mq5)
              </h2>
              <p className="text-xs text-gray-400">
                Conector nativo do MetaTrader 5 ? Multi-Rob?, Multi-Ativo e Execu??o Remota
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleCopy('script', mql5Code)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              {copiedKey === 'script' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {copiedKey === 'script' ? 'Código Copiado!' : 'Copiar PainelSync.mq5'}
              </span>
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="magic-input"
                    className="block text-[11px] font-medium text-gray-400 mb-1"
                  >
                    Magic Number (0 = todos os robôs da conta)
                  </label>
                  <input
                    id="magic-input"
                    type="number"
                    value={magicInput}
                    onChange={(e) => setMagicInput(Number(e.target.value) || 0)}
                    className="w-full bg-[#090D12] border border-[#1E2633] rounded-lg px-3 py-1.5 text-xs font-mono text-gray-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="robot-name-input"
                    className="block text-[11px] font-medium text-gray-400 mb-1"
                  >
                    Nome do Robô no Painel (quando Magic &gt; 0)
                  </label>
                  <input
                    id="robot-name-input"
                    type="text"
                    value={robotNameInput}
                    onChange={(e) => setRobotNameInput(e.target.value)}
                    className="w-full bg-[#090D12] border border-[#1E2633] rounded-lg px-3 py-1.5 text-xs font-mono text-gray-100"
                  />
                </div>
              </div>
              <div className="rounded-lg bg-[#090D12] border border-[#1E2633] p-3.5 text-xs text-gray-300 space-y-1.5 leading-relaxed">
                <div className="font-semibold text-gray-100">
                  Checklist após colocar o .ex5 no gráfico:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-gray-400">
                  <li>
                    No MT5, abra{' '}
                    <strong className="text-gray-200">
                      Ferramentas → Opções → Expert Advisors
                    </strong>
                    , marque <strong className="text-gray-200">&quot;Permitir WebRequest para os seguintes URLs&quot;</strong>, adicione{' '}
                    <code className="text-sky-300 font-mono">
                      {originUrl || endpointUrl}
                    </code>{' '}
                    e aperte <strong className="text-gray-200">Enter</strong> antes de clicar em OK.
                  </li>
                  <li>
                    Deixe o botão <strong className="text-gray-200">Algo Trading</strong> (no topo do MT5) ativado em verde e confirme nas propriedades do EA se &quot;Permitir Algo Trading&quot; está marcado.
                  </li>
                  <li>
                    Abra a aba <strong className="text-gray-200">Experts</strong> (<code className="font-mono text-gray-300">Ctrl+T</code>) para confirmar a mensagem{' '}
                    <code className="font-mono text-emerald-300">PainelSync: Sincronizado com sucesso!</code>.
                  </li>
                </ol>
              </div>
            </div>

            <pre className="max-h-96 overflow-auto rounded-lg bg-[#090D12] border border-[#1E2633] p-4 text-[11px] font-mono text-gray-300 leading-relaxed">
              {mql5Code}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
