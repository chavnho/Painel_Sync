import { useEffect, useRef, useState } from 'react';
import type { BacktestWorkerRequest, BacktestWorkerResponse } from '../workers/backtestWorker';

type BacktestInput = Omit<BacktestWorkerRequest, 'requestId'>;

export function useAsyncBacktest(input: BacktestInput) {
  const [output, setOutput] = useState<{
    simResult: BacktestWorkerResponse['simResult'];
    wdoReplayHud: BacktestWorkerResponse['wdoReplayHud'];
  }>({ simResult: null, wdoReplayHud: null });

  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<BacktestWorkerRequest | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/backtestWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<BacktestWorkerResponse>) => {
      busyRef.current = false;
      const data = event.data;
      if (data && data.requestId === reqIdRef.current) {
        setOutput((prev) =>
          prev.simResult === data.simResult && prev.wdoReplayHud === data.wdoReplayHud
            ? prev
            : { simResult: data.simResult, wdoReplayHud: data.wdoReplayHud }
        );
      }
      const next = queuedRef.current;
      if (next) {
        queuedRef.current = null;
        busyRef.current = true;
        worker.postMessage(next);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      busyRef.current = false;
      queuedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const requestId = ++reqIdRef.current;
    const payload: BacktestWorkerRequest = { ...input, requestId };

    if (busyRef.current) {
      queuedRef.current = payload;
      return;
    }

    busyRef.current = true;
    worker.postMessage(payload);
  }, [
    input.candles,
    input.effectiveReplayBars,
    input.replayInitialBar,
    input.selectedDay,
    input.isTickMode,
    input.botName,
    input.resolvedSymbol,
    input.timeframe,
    input.strategyType,
    input.maType,
    input.fastPeriod,
    input.slowPeriod,
    input.rsiPeriod,
    input.oversold,
    input.overbought,
    input.lookbackBars,
    input.onBullishSignal,
    input.onBearishSignal,
    input.risk,
    input.h1Candles,
    input.d1Candles,
  ]);

  return output;
}