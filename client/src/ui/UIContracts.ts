export const UILayer = {
  PAGE: "Page",
  POPUP: "Popup",
  GUIDE: "Guide",
  TOAST: "Toast",
  SYSTEM: "System",
} as const;

export type UILayerName = (typeof UILayer)[keyof typeof UILayer];

export const UI_LAYER_ORDER: readonly UILayerName[] = [
  UILayer.PAGE,
  UILayer.POPUP,
  UILayer.GUIDE,
  UILayer.TOAST,
  UILayer.SYSTEM,
];

export interface UINode {
  destroy(destroyChildren?: boolean): void;
}

export interface UIContainerNode extends UINode {
  name: string;
  addChild(node: UINode): UINode;
  removeChild(node: UINode): UINode;
}

export type UIMountBinding =
  | { readonly kind: "layer"; readonly layer: UILayerName }
  | { readonly kind: "outlet"; readonly parentOwnerId: number };
