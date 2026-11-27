import { initSavedTheme } from './components/ThemeSettingsModal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BuySellAnalyticsView } from './components/BuySellAnalyticsView';
import { DashboardHeader } from './components/DashboardHeader';
import { ROBOT_COLORS, getDefaultMagicColorIndex, loadMagicColorMap, saveMagicColorMap } from './utils/themeTokens';
import { Mt5BridgeView } from './components/Mt5BridgeView';
import { OverviewView } from './components/OverviewView';
import { TradesLedgerView } from './components/TradesLedgerView';
import { TradingChartView } from './components/TradingChartView';
import { WeeklyMonthlyReportView } from './components/WeeklyMonthlyReportView';
import { ConnectView } from './components/ConnectView';
import { RobotBuilderView } from './components/RobotBuilderView';
import { BacktestReplayView } from './components/BacktestReplayView';
import { LiveLogView } from './components/LiveLogView';
import type {
  DashboardTelemetry,
  DashboardView,
  Mt5SyncCredentials,
  PairingAttemptEvent,
  RemoteCommand,
} from './types/trading';
import {
  API_BASE_URL,
  loadOrCreateMt5SyncCredentials,
  regenerateMt5SyncCredentials,
} from './utils/mt5Bridge';

export default function App() {
  useEffect(() => { initSavedTheme(); }, []);
  const [activeView, setActiveView] = useState<DashboardView>('overview');

  useEffect(() => {
    const viewOrder: DashboardView[] = ['overview', 'charts', 'buy-sell', 'operations', 'reports'];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (e.key >= '1' && e.key <= '5') {
        const targetView = viewOrder[Number(e.key) - 1];
        if (targetView) { e.preventDefault(); setActiveView(targetView); }
      } else if (e.key === 'Escape') {
        setSelectedRobotId('ALL');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const [creds, setCreds] = useState<Mt5SyncCredentials>(() =>
    loadOrCreateMt5SyncCredentials()
  );
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'listening' | 'error'>('connecting');
  const [serverStartedAt, setServerStartedAt] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<DashboardTelemetry | null>(null);
  const [pairingEvents, setPairingEvents] = useState<PairingAttemptEvent[]>([]);
  const [lastCommandUpdate, setLastCommandUpdate] = useState<RemoteCommand | null>(null);
  const [selectedRobotId, setSelectedRobotId] = useState<string | 'ALL'>('ALL');
  const [magicColors, setMagicColors] = useState<Record<number, number>>(() => loadMagicColorMap());
  const handleCycleMagicColor = (magic: number, fallbackIdx: number) => {
    setMagicColors((prev) => {
      const base = prev[magic] ?? getDefaultMagicColorIndex(magic); const next = { ...prev, [magic]: (base + 1) % ROBOT_COLORS.length };
      saveMagicColorMap(next);
      return next;
    });
  };
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
          serverStartedAt?: string;
          robots?: any[];
          account?: any;
          serverReceivedAt?: string;
        };
        //console.log('Ready data:', data);
        if (typeof data.serverStartedAt === 'string') setServerStartedAt(data.serverStartedAt);
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
        if (typeof data.serverStartedAt === 'string') setServerStartedAt(data.serverStartedAt);
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

    es.addEventListener('command_update', (evt) => {
      try {
        const cmd = JSON.parse((evt as MessageEvent).data) as RemoteCommand;
        setLastCommandUpdate(cmd);
      } catch {}
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
        historyTrades: Array.isArray(bot.historyTrades)
          ? bot.historyTrades.map((t) => ({ ...t, robotName: alias }))
          : bot.historyTrades,
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

  const handleToggleHideMagic = useCallback(
    async (magicNumber: number, nextHidden: boolean) => {
      setTelemetry((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          robots: prev.robots.map((r) =>
            r.magicNumber === magicNumber ? { ...r, hidden: nextHidden } : r
          ),
        };
      });
      if (nextHidden && selectedRobotId !== 'ALL') {
        const target = robots.find((r) => r.robotId === selectedRobotId);
        if (target && target.magicNumber === magicNumber) setSelectedRobotId('ALL');
      }
      try {
        await fetch(
          `${API_BASE_URL}/api/mt5-sync/${encodeURIComponent(creds.channelId)}/robots/${encodeURIComponent(String(magicNumber))}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-sync-token': creds.token },
            body: JSON.stringify({ hidden: nextHidden }),
          }
        );
      } catch {}
    },
    [creds.channelId, creds.token, robots, selectedRobotId]
  );

  const handleClearPairingLog = useCallback(() => {
    setPairingEvents([]);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090D12] text-gray-100 overflow-hidden">
      <DashboardHeader
        serverStartedAt={serverStartedAt}
        activeView={activeView}
        onViewChange={setActiveView}
        robotsCount={robots.length}
        account={telemetry?.account ?? null}
        streamStatus={streamStatus}
        lastSyncAt={telemetry?.serverReceivedAt ?? null}
      />

      <div className="flex-1 flex min-h-0">
        <main className="flex-1 flex flex-col min-w-0 h-full bg-[#090D12] overflow-hidden">
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
              onRenameMagic={handleRenameMagic}
              onToggleHideMagic={handleToggleHideMagic}
            />
          )}

          {activeView === 'charts' && (
            <TradingChartView
              robots={robots}
              activeContracts={telemetry?.activeContracts}
              magicColors={magicColors}
              selectedRobotId={selectedRobotId}
              onSelectRobot={setSelectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'buy-sell' && (
            <BuySellAnalyticsView
              robots={robots}
              magicColors={magicColors}
              selectedRobotId={selectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'operations' && (
            <TradesLedgerView
              robots={robots}
              magicColors={magicColors}
              selectedRobotId={selectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'reports' && (
            <WeeklyMonthlyReportView
              robots={robots}
              magicColors={magicColors}
              selectedRobotId={selectedRobotId}
              onSelectRobot={setSelectedRobotId}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'robots' && <RobotBuilderView creds={creds} mt5Robots={robots} magicColors={magicColors} onCycleMagicColor={handleCycleMagicColor} onSetMagicColor={(magic, idx) => { setMagicColors((prev) => { const next = { ...prev, [magic]: idx }; saveMagicColorMap(next); return next; }); }} onRenameMagic={handleRenameMagic} onToggleHideMagic={handleToggleHideMagic} onSelectRobot={setSelectedRobotId} onNavigate={setActiveView} />}
          {activeView === 'simulator' && <BacktestReplayView creds={creds} activeContracts={telemetry?.activeContracts} />}

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
