import { PendingRequest, NormalizedCandle } from "./types";

const requestQueue: PendingRequest[] = [];

export function addToQueue(request: PendingRequest) {
  requestQueue.push(request);
  // Ordenar por timestamp para garantir FIFO
  requestQueue.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`[Queue] Pedido adicionado: ${request.id} para ${request.symbol}`);
}

export function getNextRequest(): PendingRequest | null {
  const request = requestQueue.find(r => r.status === "pending");
  if (request) {
    request.status = "processing";
  }
  return request || null;
}

export function completeRequest(id: string, result: NormalizedCandle[]) {
  const request = requestQueue.find(r => r.id === id);
  if (request) {
    request.status = "completed";
    request.result = result;
    console.log(`[Queue] Pedido concluído: ${id}`);
  }
}

export function processQueue(mt5Channels: Map<string, any>, pushPairingEvent: (channel: any, evt: any) => void) {
  const request = getNextRequest();
  if (request) {
    const channel = mt5Channels.get(request.channelId);
    if (channel) {
      pushPairingEvent(channel, {
        outcome: "request",
        httpStatus: 202,
        source: "backend",
        summary: `Processando solicitação: ${request.symbol}`,
        detail: `Enviando solicitação ID ${request.id} para o robô.`,
        requestId: request.id,
        symbol: request.symbol,
        timeframe: request.timeframe
      });
    }
  }
}
