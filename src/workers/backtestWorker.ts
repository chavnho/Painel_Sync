/// <reference lib="webworker" />
import { runBacktestSimulation } from '../engine/backtestSimulator';
import { computeWdoHudState } from '../utils/wdoChartOverlay';
import type {
  LiveCandle,
  ManagedRobotParams,
  ManagedRobotRisk,
  ManagedStrategyType,
  SignalAction,
} from '../types/trading';

export interface BacktestWorkerRequest {
  requestId: number;
  candles: LiveCandle[];
  effectiveReplayBars: number;
  replayInitialBar: number;
  selectedDay: string;
  isTickMode: boolean;
  botName: string;
  resolvedSymbol: string;
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1';
  strategyType: ManagedStrategyType;
  maType: 'EMA' | 'SMA';
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  oversold: number;
  overbought: number;
  lookbackBars: number;
  onBullishSignal: SignalAction;
  onBearishSignal: SignalAction;
  risk: ManagedRobotRisk;
  h1Candles: LiveCandle[];
  d1Candles: LiveCandle[];
}

export interface BacktestWorkerResponse {
  requestId: number;
  simResult: ReturnType<typeof runBacktestSimulation> | null;
  wdoReplayHud: ReturnType<typeof computeWdoHudState> | null;
}

self.onmessage = (event: MessageEvent<BacktestWorkerRequest>) => {
  const req = event.data;
  if (!req || !Array.isArray(req.candles)) return;

  let simResult: ReturnType<typeof runBacktestSimulation> | null = null;
  if (req.candles.length >= 6) {
    const baseParams: ManagedRobotParams =
      req.strategyType === 'ema_cross'
        ? { maType: req.maType, fastPeriod: req.fastPeriod, slowPeriod: req.slowPeriod }
        : req.strategyType === 'rsi_reversal'
          ? { rsiPeriod: req.rsiPeriod, oversold: req.oversold, overbought: req.overbought }
          : req.strategyType === 'wdo_opening_zones'
            ? { channelPoints: 7, rsiPeriod: 7, z1RsiMin: 86, z1RsiMax: 90, z5RsiMin: 10, z5RsiMax: 16 }
            : { lookbackBars: req.lookbackBars };

    const params: ManagedRobotParams = {
      ...baseParams,
      onBullishSignal: req.onBullishSignal,
      onBearishSignal: req.onBearishSignal,
    };

    simResult = runBacktestSimulation({
      robot: {
        name: req.botName,
        magicNumber: 9999,
        symbol: req.resolvedSymbol,
        timeframe: req.timeframe,
        enabled: true,
        strategyType: req.strategyType,
        params: params as Record<string, unknown>,
        risk: req.risk,
      },
      candles: req.candles,
      maxBars: req.effectiveReplayBars > 0 ? req.effectiveReplayBars : req.candles.length,
      startFromBar:
        req.strategyType === 'wdo_opening_zones' && req.selectedDay !== 'ALL'
          ? Math.max(4, req.replayInitialBar)
          : undefined,
      isTickMode: req.isTickMode,
    });
  }

  let wdoReplayHud: ReturnType<typeof computeWdoHudState> | null = null;
  if (req.strategyType === 'wdo_opening_zones' && req.candles.length > 0) {
    const targetCount =
      req.effectiveReplayBars > 0 ? Math.min(req.effectiveReplayBars, req.candles.length) : req.candles.length;
    const vis = req.candles.slice(0, targetCount);
    const rsiPer = Math.max(2, Number(req.rsiPeriod) || 7);
    wdoReplayHud = computeWdoHudState(vis, 7, rsiPer, req.h1Candles, req.d1Candles, true, req.selectedDay);
  }

  const response: BacktestWorkerResponse = {
    requestId: req.requestId,
    simResult,
    wdoReplayHud,
  };
  self.postMessage(response);
};