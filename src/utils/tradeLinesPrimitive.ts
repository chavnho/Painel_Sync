import type {
  IChartApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

export interface TradeSegmentItem {
  entryTime: UTCTimestamp;
  entryPrice: number;
  exitTime: UTCTimestamp;
  exitPrice: number;
  color: string;
  dotColor?: string;
}

class TradeLinesRenderer implements IPrimitivePaneRenderer {
  private readonly items: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    dotColor: string;
  }>;

  constructor(
    items: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dotColor: string }>
  ) {
    this.items = items;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: {
    context: CanvasRenderingContext2D;
    horizontalPixelRatio: number;
    verticalPixelRatio: number;
  }) => void) => void }): void {
    if (this.items.length === 0) return;

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
      ctx.save();
      for (const item of this.items) {
        const x1 = item.x1 * hpr;
        const y1 = item.y1 * vpr;
        const x2 = item.x2 * hpr;
        const y2 = item.y2 * vpr;

        ctx.beginPath();
        ctx.strokeStyle = '#090D12';
        ctx.lineWidth = 4.2 * hpr;
        ctx.setLineDash([5 * hpr, 4 * hpr]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2.4 * hpr;
        ctx.setLineDash([5 * hpr, 4 * hpr]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.fillStyle = item.dotColor;
        ctx.strokeStyle = '#090D12';
        ctx.lineWidth = 1.5 * hpr;
        ctx.arc(x1, y1, 4.5 * hpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = item.dotColor;
        ctx.strokeStyle = '#090D12';
        ctx.lineWidth = 1.5 * hpr;
        ctx.arc(x2, y2, 4.5 * hpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class TradeLinesPaneView implements IPrimitivePaneView {
  private readonly primitive: TradeLinesPrimitive;

  constructor(primitive: TradeLinesPrimitive) {
    this.primitive = primitive;
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.primitive.buildRenderer();
  }
}

export class TradeLinesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: SeriesAttachedParameter<Time>['series'] | null = null;
  private requestUpdate?: () => void;
  private segments: TradeSegmentItem[] = [];
  private readonly paneView: TradeLinesPaneView;

  constructor() {
    this.paneView = new TradeLinesPaneView(this);
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }

  setSegments(next: TradeSegmentItem[]): void {
    this.segments = next;
    this.requestUpdate?.();
    this.chart?.applyOptions({});
  }

  buildRenderer(): IPrimitivePaneRenderer | null {
    if (!this.chart || !this.series || this.segments.length === 0) return null;
    const timeScale = this.chart.timeScale();
    const coords: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dotColor: string }> = [];

    for (const seg of this.segments) {
      const x1 = timeScale.timeToCoordinate(seg.entryTime);
      const y1 = this.series.priceToCoordinate(seg.entryPrice);
      const x2 = timeScale.timeToCoordinate(seg.exitTime);
      const y2 = this.series.priceToCoordinate(seg.exitPrice);
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
      coords.push({
        x1,
        y1,
        x2,
        y2,
        color: seg.color,
        dotColor: seg.dotColor ?? seg.color,
      });
    }

    return new TradeLinesRenderer(coords);
  }
}