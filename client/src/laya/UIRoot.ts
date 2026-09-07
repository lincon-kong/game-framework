import {
  UI_LAYER_ORDER,
  type UIContainerNode,
  type UILayerName,
  type UINode,
} from "../ui/UIContracts";
import { createLayaViewportSource } from "./LayaRuntime";
import {
  activateUILayoutRuntime,
  deactivateUILayoutRuntime,
  UILayoutRuntime,
  UILayoutType,
  type UILayoutNode,
  type UIViewportSource,
} from "./UIViewport";

export type UIRootStatus = "Created" | "Mounted" | "Disposed";
export type CreateUIContainerNode = () => UIContainerNode;

interface LayaUiRuntime {
  readonly stage: unknown;
  readonly Sprite: new () => unknown;
}

declare const Laya: LayaUiRuntime;

function createDefaultContainerNode(): UIContainerNode {
  return new Laya.Sprite() as unknown as UIContainerNode;
}

function requireLayerName(layer: string): asserts layer is UILayerName {
  if (!UI_LAYER_ORDER.includes(layer as UILayerName)) {
    throw new Error(`Unknown UI layer "${layer}".`);
  }
}

export class UIRoot {
  private currentStatus: UIRootStatus = "Created";
  private readonly layerNodes = new Map<UILayerName, UIContainerNode>();
  private readonly attachedNodes = new Map<UILayerName, Set<UINode>>();
  private readonly layoutRuntime: UILayoutRuntime;
  private readonly layoutDisposers: Array<() => void> = [];

  public readonly root: UIContainerNode;

  public constructor(
    private readonly stage: UIContainerNode = Laya.stage as unknown as UIContainerNode,
    private readonly createContainerNode: CreateUIContainerNode = createDefaultContainerNode,
    viewportSource?: UIViewportSource,
  ) {
    if (stage === null || typeof stage.addChild !== "function") {
      throw new TypeError("UIRoot stage must be a Laya node.");
    }

    this.root = this.createContainerNode();
    this.root.name = "UIRoot";
    this.layoutRuntime = new UILayoutRuntime(viewportSource ?? createLayaViewportSource());

    for (const layer of UI_LAYER_ORDER) {
      const layerNode = this.createContainerNode();
      layerNode.name = layer;
      this.root.addChild(layerNode);
      this.layerNodes.set(layer, layerNode);
      this.attachedNodes.set(layer, new Set());
    }
  }

  public get status(): UIRootStatus {
    return this.currentStatus;
  }

  public mount(): void {
    if (this.currentStatus !== "Created") {
      throw new Error(`UIRoot cannot mount from status ${this.currentStatus}.`);
    }

    try {
      this.layoutRuntime.start();
      activateUILayoutRuntime(this.layoutRuntime);
      this.layoutDisposers.push(this.layoutRuntime.register(this.root as unknown as UILayoutNode, UILayoutType.Full));
      for (const layerNode of this.layerNodes.values()) {
        this.layoutDisposers.push(this.layoutRuntime.register(layerNode as unknown as UILayoutNode, UILayoutType.Full));
      }
      this.stage.addChild(this.root);
      this.currentStatus = "Mounted";
    } catch (error: unknown) {
      this.disposeLayoutRuntime();
      throw error;
    }
  }

  public getLayer(layer: UILayerName): UIContainerNode {
    this.ensureNotDisposed();
    requireLayerName(layer);
    const layerNode = this.layerNodes.get(layer);
    if (layerNode === undefined) {
      throw new Error(`UI layer "${layer}" is not registered.`);
    }
    return layerNode;
  }

  public add<T extends UINode>(layer: UILayerName, node: T): T {
    this.requireMounted();
    const layerNode = this.getLayer(layer);
    if (node === null || typeof node.destroy !== "function") {
      throw new TypeError("UI node must be a Laya node.");
    }

    layerNode.addChild(node);
    this.attachedNodes.get(layer)?.add(node);
    return node;
  }

  public remove<T extends UINode>(layer: UILayerName, node: T, destroy = true): T {
    this.requireMounted();
    const attachedNodes = this.attachedNodes.get(layer);
    if (attachedNodes === undefined) {
      requireLayerName(layer);
      throw new Error(`UI layer "${layer}" is not registered.`);
    }
    if (!attachedNodes.has(node)) {
      throw new Error(`UI node is not attached to layer "${layer}".`);
    }

    const layerNode = this.getLayer(layer);
    layerNode.removeChild(node);
    attachedNodes.delete(node);
    if (destroy) {
      node.destroy(true);
    }
    return node;
  }

  public dispose(): void {
    if (this.currentStatus === "Disposed") {
      return;
    }

    this.root.destroy(true);
    this.disposeLayoutRuntime();
    for (const nodes of this.attachedNodes.values()) {
      nodes.clear();
    }
    this.currentStatus = "Disposed";
  }

  private disposeLayoutRuntime(): void {
    for (const dispose of this.layoutDisposers.splice(0).reverse()) dispose();
    deactivateUILayoutRuntime(this.layoutRuntime);
    this.layoutRuntime.stop();
  }

  private requireMounted(): void {
    if (this.currentStatus !== "Mounted") {
      throw new Error(`UIRoot operation requires Mounted status, got ${this.currentStatus}.`);
    }
  }

  private ensureNotDisposed(): void {
    if (this.currentStatus === "Disposed") {
      throw new Error("UIRoot has already been disposed.");
    }
  }
}
