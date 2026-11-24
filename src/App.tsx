import { useCallback, useEffect, useMemo, useState } from 'react';
import { BuySellAnalyticsView } from './components/BuySellAnalyticsView';
import { DashboardHeader } from './components/DashboardHeader';
import { Mt5BridgeView } from './components/Mt5BridgeView';
import { OverviewView } from './components/OverviewView';
import { RobotSidebar } from './components/RobotSidebar';
import { TradesLedgerView } from './components/TradesLedgerView';
import { TradingChartView } from './components/TradingChartView';
import { IndependentChartView } from './components/IndependentChartView';
import { WeeklyMonthlyReportView } from './components/WeeklyMonthlyReportView';
import { ConnectView } from './components/ConnectView';
import { LiveLogView } from './components/LiveLogView';
import type {
  DashboardTelemetry,
  DashboardView,
  Mt5SyncCredentials,
  PairingAttemptEvent,
} from './types/trading';
import {
  API_BASE_URL,
  loadOrCreateMt5SyncCredentials,
  regenerateMt5SyncCredentials,
} from './utils/mt5Bridge';

export default function App() {
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [creds, setCreds] = useState<Mt5SyncCredentials>(() =>
    loadOrCreateMt5SyncCredentials()
  );
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'listening' | 'error'>(
    'connecting'
  );
  const [telemetry, setTelemetry] = useState<DashboardTelemetry | null>(null);
  const [pairingEvents, setPairingEvents] = useState<PairingAttemptEvent[]>([]);
  const [selectedRobotId, setSelectedRobotId] = useState<string | 'ALL'>('ALL');
  const [magicAliases, setMagicAliases] = useState<Record<number, string>>(() => {
    try {
      const raw = localStorage.getItem('painel_sync_magic_aliases_v1');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  const handleRenameMagic = useCallback((magicNumber: number, nextName: string) => {
    setMagicAliases((prev) => {
      const updated = { ...prev };
      const trimmed = nextName.trim();
      if (trimmed) {
        updated[magicNumber] = trimmed;
      } else {
        delete updated[magicNumber];
      }
      try {
        localStorage.setItem('painel_sync_magic_aliases_v1', JSON.stringify(updated));
      } catch {
        // ignora erro de quota
      }
      return updated;
    });
  }, []);

  // Conecta ao stream SSE em tempo real do servidor
  useEffect(() => {
    setStreamStatus('connecting');
    const url = `${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(creds.channelId)}/stream?token=${encodeURIComponent(creds.token)}`;
    //console.log('Attempting SSE connection to:', url);
    const es = new EventSource(url);
    //console.log('EventSource instance created');

    es.addEventListener('ready', (evt) => {
      //console.log('SSE "ready" event received');
      setStreamStatus('listening');
      try {
        const data = JSON.parse((evt as MessageEvent).data) as {
          pairingEvents?: PairingAttemptEvent[];
          robots?: any[];
          account?: any;
          serverReceivedAt?: string;
        };
        //console.log('Ready data:', data);
        if (Array.isArray(data.pairingEvents)) {
          setPairingEvents(data.pairingEvents);
        }
        if (data.robots) {
          setTelemetry({
            robots: data.robots,
            account: data.account,
            serverReceivedAt: data.serverReceivedAt ?? '',
            channelId: creds.channelId,
          });
        }
      } catch (e) {
        console.error('Error parsing "ready" data:', e);
      }
    });

    es.addEventListener('telemetry', (evt) => {
      //console.log('SSE "telemetry" event received');
      try {
        const data = JSON.parse((evt as MessageEvent).data) as DashboardTelemetry;
        //console.log('Telemetry data:', data);
        setTelemetry(data);
        if (Array.isArray(data.pairingEvents)) {
          setPairingEvents(data.pairingEvents);
        }
        setStreamStatus('listening');
      } catch (e) {
        console.error('Error parsing "telemetry" data:', e);
      }
    });

    es.addEventListener('pairing_event', (evt) => {
      try {
        const nextEvent = JSON.parse((evt as MessageEvent).data) as PairingAttemptEvent;
        setPairingEvents((prev) => {
          const withoutDup = prev.filter((item) => item.id !== nextEvent.id);
          return [nextEvent, ...withoutDup].slice(0, 30);
        });
      } catch {
        // ignora payload malformado
      }
    });

    es.addEventListener('cleared', () => {
      setTelemetry(null);
      setSelectedRobotId('ALL');
    });

    es.onerror = () => {
      setStreamStatus('error');
    };

    return () => {
      es.close();
    };
  }, [creds.channelId, creds.token]);

  const robots = useMemo(() => {
    const raw = telemetry?.robots ?? [];
    return raw.map((bot) => {
      const alias = magicAliases[bot.magicNumber];
      if (!alias) return bot;
      return {
        ...bot,
        name: alias,
        trades: Array.isArray(bot.trades)
          ? bot.trades.map((t) => ({ ...t, robotName: alias }))
          : bot.trades,
      };
    });
  }, [telemetry?.robots, magicAliases]);

  useEffect(() => {
    if (
      selectedRobotId !== 'ALL' &&
      !robots.some((r) => r.robotId === selectedRobotId)
    ) {
      setSelectedRobotId('ALL');
    }
  }, [robots, selectedRobotId]);

  const handleClearSession = useCallback(async () => {
    try {
      await fetch(`/api/mt5-sync/${encodeURIComponent(creds.channelId)}`, {
        method: 'DELETE',
        headers: { 'x-sync-token': creds.token },
      });
      setTelemetry(null);
      setSelectedRobotId('ALL');
    } catch {
      // ignora erro de rede
    }
  }, [creds.channelId, creds.token]);

  const handleRegenerateToken = useCallback(() => {
    const next = regenerateMt5SyncCredentials();
    setCreds(next);
    setTelemetry(null);
    setPairingEvents([]);
    setSelectedRobotId('ALL');
  }, []);

  const handleClearPairingLog = useCallback(() => {
    setPairingEvents([]);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E11] text-gray-100 overflow-hidden">
      <DashboardHeader activeView={activeView} onViewChange={setActiveView} />

      <div className="flex-1 flex min-h-0">
        <RobotSidebar
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelectRobot={setSelectedRobotId}
          onRenameMagic={handleRenameMagic}
          account={telemetry?.account ?? null}
          streamStatus={streamStatus}
          lastSyncAt={telemetry?.serverReceivedAt ?? null}
          activeView={activeView}
          onViewChange={setActiveView}
        />

        <main className="flex-1 flex flex-col min-w-0 h-full bg-[#0B0E11] overflow-hidden">
          {activeView === 'overview' && (
            <OverviewView
              robots={robots}
              selectedRobotId={selectedRobotId}
              onSelectRobot={setSelectedRobotId}
              onNavigate={setActiveView}
              account={telemetry?.account ?? null}
              creds={creds}
              streamStatus={streamStatus}
              pairingEvents={pairingEvents}
              lastSyncAt={telemetry?.serverReceivedAt ?? null}
              onClearPairingLog={handleClearPairingLog}
            />
          )}

          {activeView === 'charts' && (
            <TradingChartView
              robots={robots}
              selectedRobotId={selectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'buy-sell' && (
            <BuySellAnalyticsView
              robots={robots}
              selectedRobotId={selectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'operations' && (
            <TradesLedgerView
              robots={robots}
              selectedRobotId={selectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'reports' && (
            <WeeklyMonthlyReportView
              robots={robots}
              selectedRobotId={selectedRobotId}
              onSelectRobot={setSelectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'market-chart' && (
            <IndependentChartView
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'connect' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              <ConnectView
                streamStatus={streamStatus}
                telemetry={telemetry}
                pairingEvents={pairingEvents}
                creds={creds}
                onClearSession={handleClearSession}
              />
              <LiveLogView events={pairingEvents} />
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
