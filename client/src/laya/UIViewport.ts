export enum UILayoutType {
  Full = 0,
  Safe = 1,
  Pop = 2,
}

export interface UIRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface UIViewportSnapshot {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly full: UIRect;
  readonly safe: UIRect;
}

export interface UIViewportMetrics {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly windowWidth?: number;
  readonly windowHeight?: number;
  readonly safeLeft?: number;
  readonly safeTop?: number;
  /** Right edge coordinate of the platform safe area, not a right inset. */
  readonly safeRight?: number;
  /** Bottom edge coordinate of the platform safe area, not a bottom inset. */
  readonly safeBottom?: number;
}

export interface UIViewportSource {
  read(): UIViewportSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface UILayoutNode {
  x: number;
  y: number;
  width: number;
  height: number;
  readonly pivotX?: number;
  readonly pivotY?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

const FIXED_WIDTH_EPSILON = 0.5;

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

export function createUIViewportSnapshot(metrics: UIViewportMetrics): UIViewportSnapshot {
  requirePositiveFinite(metrics.designWidth, "designWidth");
  requirePositiveFinite(metrics.designHeight, "designHeight");
  requirePositiveFinite(metrics.stageWidth, "stageWidth");
  requirePositiveFinite(metrics.stageHeight, "stageHeight");

  if (Math.abs(metrics.stageWidth - metrics.designWidth) > FIXED_WIDTH_EPSILON) {
    throw new Error(
      `UI viewport requires Laya fixed-width adaptation: stage width ${metrics.stageWidth} does not match design width ${metrics.designWidth}.`,
    );
  }

  const full: UIRect = Object.freeze({
    x: 0,
    y: 0,
    width: metrics.stageWidth,
    height: metrics.stageHeight,
  });
  const hasSafeArea =
    metrics.windowWidth !== undefined
    && metrics.windowHeight !== undefined
    && metrics.safeTop !== undefined
    && metrics.safeBottom !== undefined;

  if (!hasSafeArea) {
    return Object.freeze({
      designWidth: metrics.designWidth,
      designHeight: metrics.designHeight,
      full,
      safe: full,
    });
  }

  const windowWidth = metrics.windowWidth!;
  const windowHeight = metrics.windowHeight!;
  const safeLeft = metrics.safeLeft ?? 0;
  const safeTop = metrics.safeTop!;
  const safeRight = metrics.safeRight ?? windowWidth;
  const safeBottom = metrics.safeBottom!;
  requirePositiveFinite(windowWidth, "windowWidth");
  requirePositiveFinite(windowHeight, "windowHeight");

  if (
    !Number.isFinite(safeLeft)
    || !Number.isFinite(safeTop)
    || !Number.isFinite(safeRight)
    || !Number.isFinite(safeBottom)
  ) {
    throw new RangeError("Safe-area coordinates must be finite numbers.");
  }
  if (safeLeft < 0 || safeRight < safeLeft || safeRight > windowWidth) {
    throw new RangeError(
      `Invalid safe-area horizontal bounds: left=${safeLeft}, right=${safeRight}, windowWidth=${windowWidth}.`,
    );
  }
  if (safeTop < 0 || safeBottom < safeTop || safeBottom > windowHeight) {
    throw new RangeError(
      `Invalid safe-area vertical bounds: top=${safeTop}, bottom=${safeBottom}, windowHeight=${windowHeight}.`,
    );
  }

  const scale = metrics.stageWidth / windowWidth;
  const leftInset = safeLeft * scale;
  const topInset = safeTop * scale;
  const rightInset = (windowWidth - safeRight) * scale;
  const bottomInset = (windowHeight - safeBottom) * scale;
  const safeWidth = metrics.stageWidth - leftInset - rightInset;
  const safeHeight = metrics.stageHeight - topInset - bottomInset;
  if (safeWidth < 0 || safeHeight < 0) {
    throw new RangeError(
      `Mapped safe area exceeds the Laya stage: leftInset=${leftInset}, topInset=${topInset}, rightInset=${rightInset}, bottomInset=${bottomInset}, stageWidth=${metrics.stageWidth}, stageHeight=${metrics.stageHeight}.`,
    );
  }

  const safe: UIRect = Object.freeze({
    x: leftInset,
    y: topInset,
    width: safeWidth,
    height: safeHeight,
  });

  return Object.freeze({
    designWidth: metrics.designWidth,
    designHeight: metrics.designHeight,
    full,
    safe,
  });
}

export class UILayoutRuntime {
  private readonly bindings = new Map<UILayoutNode, UILayoutType>();
  private currentViewport: UIViewportSnapshot | undefined;
  private stopSource: (() => void) | undefined;

  public constructor(private readonly source: UIViewportSource) {}

  public get viewport(): UIViewportSnapshot {
    if (this.currentViewport === undefined) {
      throw new Error("UI layout runtime is not started.");
    }
    return this.currentViewport;
  }

  public start(): void {
    if (this.stopSource !== undefined) {
      throw new Error("UI layout runtime is already started.");
    }
    this.currentViewport = this.source.read();
    this.stopSource = this.source.subscribe(() => this.reflow());
  }

  public stop(): void {
    const stopSource = this.stopSource;
    this.stopSource = undefined;
    if (stopSource !== undefined) stopSource();
    this.bindings.clear();
    this.currentViewport = undefined;
  }

  public register(node: UILayoutNode, type: UILayoutType): () => void {
    const viewport = this.viewport;
    if (this.bindings.has(node)) {
      throw new Error("UI node already has an active layout binding.");
    }
    this.bindings.set(node, type);
    this.apply(node, type, viewport);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.bindings.delete(node);
    };
  }

  public reflow(): void {
    if (this.currentViewport === undefined) {
      throw new Error("UI layout runtime cannot reflow before start.");
    }
    const viewport = this.source.read();
    this.currentViewport = viewport;
    for (const [node, type] of this.bindings) this.apply(node, type, viewport);
  }

  private apply(node: UILayoutNode, type: UILayoutType, viewport: UIViewportSnapshot): void {
    if (type === UILayoutType.Full) {
      this.applyRect(node, viewport.full);
      return;
    }
    if (type === UILayoutType.Safe) {
      this.applyRect(node, viewport.safe);
      return;
    }
    if (type !== UILayoutType.Pop) {
      throw new Error(`Unknown UI layout type: ${String(type)}.`);
    }

    requirePositiveFinite(node.width, "Pop node width");
    requirePositiveFinite(node.height, "Pop node height");
    const pivotX = Number.isFinite(node.pivotX) ? node.pivotX! : 0;
    const pivotY = Number.isFinite(node.pivotY) ? node.pivotY! : 0;
    const scaleX = Number.isFinite(node.scaleX) ? node.scaleX! : 1;
    const scaleY = Number.isFinite(node.scaleY) ? node.scaleY! : 1;
    const safeCenterX = viewport.safe.x + viewport.safe.width * 0.5;
    const safeCenterY = viewport.safe.y + viewport.safe.height * 0.5;
    node.x = safeCenterX - (node.width * 0.5 - pivotX) * scaleX;
    node.y = safeCenterY - (node.height * 0.5 - pivotY) * scaleY;
  }

  private applyRect(node: UILayoutNode, rect: UIRect): void {
    node.x = rect.x;
    node.y = rect.y;
    node.width = rect.width;
    node.height = rect.height;
  }
}

let activeUILayoutRuntime: UILayoutRuntime | undefined;

export function activateUILayoutRuntime(runtime: UILayoutRuntime): void {
  if (activeUILayoutRuntime !== undefined && activeUILayoutRuntime !== runtime) {
    throw new Error("Only one active UI layout runtime is allowed.");
  }
  activeUILayoutRuntime = runtime;
}

export function deactivateUILayoutRuntime(runtime: UILayoutRuntime): void {
  if (activeUILayoutRuntime === runtime) activeUILayoutRuntime = undefined;
}

export function registerUILayoutNode(node: UILayoutNode, type: UILayoutType): () => void {
  if (activeUILayoutRuntime === undefined) {
    throw new Error("UI layout runtime is not active. UIRoot must be mounted before UILayout components enable.");
  }
  return activeUILayoutRuntime.register(node, type);
}
