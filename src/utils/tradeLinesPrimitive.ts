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

      if (this.items.length > 0) {
        const dash = [5 * hpr, 4 * hpr];
        ctx.setLineDash(dash);
        for (const item of this.items) {
          const x1 = item.x1 * hpr;
          const y1 = item.y1 * vpr;
          const x2 = item.x2 * hpr;
          const y2 = item.y2 * vpr;

          ctx.beginPath();
          ctx.strokeStyle = '#090D12';
          ctx.lineWidth = 4.2 * hpr;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          ctx.beginPath();
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 2.4 * hpr;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        ctx.setLineDash(new Array<number>());
        ctx.strokeStyle = '#090D12';
        ctx.lineWidth = 1.5 * hpr;
        const r = 4.5 * hpr;
        const twoPi = Math.PI * 2;
        for (const item of this.items) {
          const x1 = item.x1 * hpr;
          const y1 = item.y1 * vpr;
          const x2 = item.x2 * hpr;
          const y2 = item.y2 * vpr;

          ctx.fillStyle = item.dotColor;
          ctx.beginPath();
          ctx.arc(x1, y1, r, 0, twoPi);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(x2, y2, r, 0, twoPi);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (this.levels.length > 0) {
        ctx.setLineDash(new Array<number>());
        ctx.lineWidth = 2 * hpr;
        ctx.font = `600 ${Math.round(10 * hpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'middle';
        for (const lvl of this.levels) {
          const x1 = lvl.x1 * hpr;
          const x2 = lvl.x2 * hpr;
          const y = lvl.y * vpr;

          ctx.beginPath();
          ctx.strokeStyle = lvl.color;
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();

          if (lvl.label) {
            ctx.fillStyle = lvl.color;
            ctx.fillText(lvl.label, x2 + 4 * hpr, y);
          }
        }
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
  private segments: Array<TradeSegmentItem> = new Array();
  private localLevels: Array<LocalLevelItem> = new Array();
  private lastLevelsSig = '';
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
  }

  setLocalLevels(next: Array<LocalLevelItem>): void {
    const sig = next.map((l) => `${l.anchorLeftTime}:${l.anchorRightTime}:${l.price}:${l.label}`).join('|');
    if (sig === this.lastLevelsSig) return;
    this.lastLevelsSig = sig;
    this.localLevels = next;
    this.requestUpdate?.();
  }

  buildRenderer(): IPrimitivePaneRenderer | null {
    if (!this.chart || !this.series || (this.segments.length === 0 && this.localLevels.length === 0)) return null;
    const timeScale = this.chart.timeScale();
    const maxW = timeScale.width();
    const coords = new Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dotColor: string }>();

    for (const seg of this.segments) {
      const x1 = timeScale.timeToCoordinate(seg.entryTime);
      const x2 = timeScale.timeToCoordinate(seg.exitTime);
      if (x1 === null || x2 === null) continue;
      if ((x1 < -50 && x2 < -50) || (x1 > maxW + 50 && x2 > maxW + 50)) continue;
      const y1 = this.series.priceToCoordinate(seg.entryPrice);
      const y2 = this.series.priceToCoordinate(seg.exitPrice);
      if (y1 === null || y2 === null) continue;
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