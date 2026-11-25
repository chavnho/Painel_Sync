import React, { useState, useRef, useEffect } from 'react';
import type { PairingAttemptEvent } from '../types/trading';

interface LiveLogViewProps {
  events: PairingAttemptEvent[];
}

export function LiveLogView({ events }: LiveLogViewProps) {
  const [logs, setLogs] = useState<Array<{ id: string; message: string; type: 'info' | 'success' | 'error'; timestamp: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newLogs = events.map((event) => {
      let type: 'info' | 'success' | 'error' = 'info';
      if (event.outcome === 'success') type = 'success';
      if (event.outcome === 'error') type = 'error';

      return {
        id: event.id,
        message: `[${event.symbol || 'SYS'}] ${event.outcome.toUpperCase()} - ${event.summary}`,
        type,
        timestamp: event.timestamp
      };
    });
    setLogs(newLogs);
  }, [events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-32 bg-[#090D12] border-t border-[#1E2633] p-4 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Live Event Feed</h3>
        <span className="text-[10px] text-emerald-500 animate-pulse">● Live</span>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar"
      >
        {logs.length === 0 && (
          <p className="text-gray-600 text-xs italic">Aguardando eventos do sistema...</p>
        )}
        {logs.map((log, i) => (
          <div key={i} className="text-[11px] font-mono flex gap-3">
            <span className="text-gray-600 shrink-0">[{log.timestamp}]</span>
            <span className={
              log.type === 'success' ? 'text-emerald-400' : 
              log.type === 'error' ? 'text-rose-400' : 
              'text-gray-300'
            }>
              {log.message}
            </span>
          </div>
        ))}
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1E2633;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
