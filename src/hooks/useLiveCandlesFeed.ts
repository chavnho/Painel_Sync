import { useEffect, useRef } from 'react';
import type { LiveCandle } from '../types/trading';
import { fetchCandles, syncCandlesWithMt5 } from '../utils/mt5Bridge';

export function timeframeToSeconds(tf: string): number {
  const upper = tf.trim().toUpperCase();
  if (upper === 'M1') return 60;
  if (upper === 'M5') return 300;
  if (upper === 'M15') return 900;
  if (upper === 'M30') return 1800;
  if (upper === 'H1') return 3600;
  if (upper === 'H4') return 14400;
  if (upper === 'D1') return 86400;
  return 300;
}

export function mergeLiveCandlesWithAutoHeal(
  prev: LiveCandle[],
  incoming: LiveCandle[],
  tfSec: number,
  isFullLoad: boolean
): { candles: LiveCandle[]; hadGap: boolean; changed: boolean } {
  if (isFullLoad || prev.length === 0 || incoming.length > 50) {
    const prevLast = prev.at(-1);
    const incLast = incoming.at(-1);
    const same =
      prev.length === incoming.length &&
      prevLast?.time === incLast?.time &&
      prevLast?.close === incLast?.close &&
      prevLast?.high === incLast?.high &&
      prevLast?.low === incLast?.low &&
      prevLast?.volume === incLast?.volume;
    return { candles: same ? prev : incoming, hadGap: false, changed: !same };
  }

  const prevLast = prev.at(-1);
  const incFirst = incoming.at(0);
  const hadGap = Boolean(
    prevLast && incFirst && Number(incFirst.time) - Number(prevLast.time) > tfSec * 2
  );

  const byTime = new Map<number, LiveCandle>();
  for (const b of prev) byTime.set(Number(b.time), b);
  for (const b of incoming) byTime.set(Number(b.time), b);

  const merged = Array.from(byTime.entries())
    .sort(([tA], [tB]) => tA - tB)
    .map(([, bar], idx) => ({ ...bar, index: idx }));

  const nextLast = merged.at(-1);
  const same =
    prev.length === merged.length &&
    prevLast?.time === nextLast?.time &&
    prevLast?.close === nextLast?.close &&
    prevLast?.high === nextLast?.high &&
    prevLast?.low === nextLast?.low &&
    prevLast?.volume === nextLast?.volume;

  return { candles: same ? prev : merged, hadGap, changed: !same };
}

export interface UseLiveCandlesFeedOptions {
  enabled: boolean;
  channelId: string;
  token: string;
  symbol: string;
  timeframe: string;
  intervalMs?: number;
  tailSize?: number;
  forceInitialSync?: boolean;
  onCandles: (incoming: LiveCandle[], meta: { isFirstLoad: boolean; hadGap: boolean }) => void;
  onError?: (err: unknown, isFirstLoad: boolean) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export function useLiveCandlesFeed({
  enabled,
  channelId,
  token,
  symbol,
  timeframe,
  intervalMs = 250,
  tailSize = 10,
  forceInitialSync = true,
  onCandles,
  onError,
  onLoadingChange,
}: UseLiveCandlesFeedOptions): void {
  const onCandlesRef = useRef(onCandles);
  const onErrorRef = useRef(onError);
  const onLoadingRef = useRef(onLoadingChange);
  onCandlesRef.current = onCandles;
  onErrorRef.current = onError;
  onLoadingRef.current = onLoadingChange;

  useEffect(() => {
    if (!enabled || !channelId || !token || !symbol || !timeframe) return;

    const controller = new AbortController();
    let inFlight = false;
    let needFullTail = true;

    const load = async (isFirstLoad: boolean) => {
      if (isFirstLoad) onLoadingRef.current?.(true);
      try {
        const result =
          isFirstLoad && forceInitialSync
            ? await syncCandlesWithMt5(channelId, token, symbol, timeframe, {
                force: true,
                isManualRequest: true,
                signal: controller.signal,
              })
            : await fetchCandles(
                channelId,
                token,
                symbol,
                timeframe,
                controller.signal,
                undefined,
                needFullTail ? undefined : tailSize
              );

        if (!controller.signal.aborted && result && result.length > 0) {
          needFullTail = false;
          onCandlesRef.current(result, { isFirstLoad, hadGap: false });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          onErrorRef.current?.(err, isFirstLoad);
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && isFirstLoad) {
          onLoadingRef.current?.(false);
        }
      }
    };

    const tick = (first: boolean) => {
      if (inFlight) return;
      inFlight = true;
      void load(first);
    };

    tick(true);
    const id = window.setInterval(() => tick(false), intervalMs);

    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [enabled, channelId, token, symbol, timeframe, intervalMs, tailSize, forceInitialSync]);
}