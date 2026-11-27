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

export interface LocalLevelItem { anchorLeftTime: UTCTimestamp; anchorRightTime: UTCTimestamp; price: number; color: string; label: string; }
export interface TradeSegmentItem {
  entryTime: UTCTimestamp;
  entryPrice: number;
  exitTime: UTCTimestamp;
  exitPrice: number;
  color: string;
  dotColor?: string;
}

export interface LocalLevelItem {
  anchorLeftTime: UTCTimestamp;
  anchorRightTime: UTCTimestamp;
  price: number;
  color: string;
  label: string;
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
  private readonly levels: Array<{
    x1: number;
    x2: number;
    y: number;
    color: string;
    label: string;
  }>;

  constructor(
    items: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dotColor: string }>,
    levels: Array<{ x1: number; x2: number; y: number; color: string; label: string }> = new Array()
  ) {
    this.items = items;
    this.levels = levels;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: {
    context: CanvasRenderingContext2D;
    horizontalPixelRatio: number;
    verticalPixelRatio: number;
  }) => void) => void }): void {
    if (this.items.length === 0 && this.levels.length === 0) return;

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

      for (const lvl of this.levels) {
        const x1 = lvl.x1 * hpr;
        const x2 = lvl.x2 * hpr;
        const y = lvl.y * vpr;

        ctx.beginPath();
        ctx.strokeStyle = lvl.color;
        ctx.lineWidth = 2 * hpr;
        ctx.setLineDash([3 * hpr, 3 * hpr]);
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (lvl.label) {
          ctx.font = `600 ${Math.round(10 * hpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = lvl.color;
          ctx.textBaseline = 'middle';
          ctx.fillText(lvl.label, x2 + 4 * hpr, y);
        }
      }
      for (const lvl of this.levels) { const x1 = lvl.x1 * hpr; const x2 = lvl.x2 * hpr; const y = lvl.y * vpr; ctx.beginPath(); ctx.strokeStyle = lvl.color; ctx.lineWidth = 2 * hpr; ctx.setLineDash([3 * hpr, 3 * hpr]); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash(new Array<number>()); if (lvl.label) { ctx.font = '600 ' + Math.round(10 * hpr) + 'px monospace'; ctx.fillStyle = lvl.color; ctx.textBaseline = 'middle'; ctx.fillText(lvl.label, x2 + 4 * hpr, y); } }
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
  private segments: Array<TradeSegmentItem> = new Array();
  private localLevels: Array<LocalLevelItem> = new Array();
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

  setSegments(next: Array<TradeSegmentItem>): void {
    this.segments = next;
    this.requestUpdate?.();
    this.chart?.applyOptions({});
  }

  setLocalLevels(next: Array<LocalLevelItem>): void {
    this.localLevels = next;
    this.requestUpdate?.();
    this.chart?.applyOptions({});
  }

  buildRenderer(): IPrimitivePaneRenderer | null {
    if (!this.chart || !this.series || (this.segments.length === 0 && this.localLevels.length === 0)) return null;
    const timeScale = this.chart.timeScale();
    const coords = new Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dotColor: string }>();

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

    const levelCoords = new Array<{ x1: number; x2: number; y: number; color: string; label: string }>();
    for (const lvl of this.localLevels) {
      const xLeft = timeScale.timeToCoordinate(lvl.anchorLeftTime);
      const xRight = timeScale.timeToCoordinate(lvl.anchorRightTime);
      const y = this.series.priceToCoordinate(lvl.price);
      if (xLeft === null || xRight === null || y === null) continue;
      const span = Math.max(24, xRight - xLeft);
      levelCoords.push({
        x1: xLeft,
        x2: xRight + span,
        y,
        color: lvl.color,
        label: lvl.label,
      });
    }

    return new TradeLinesRenderer(coords, levelCoords);
  }
}