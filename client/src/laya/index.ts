export * from "./LayaAdapters";
export * from "./LayaRuntime";
export * from "./UIRoot";
// Keep the component-facing layout exports explicit. Laya's editor module
// loader does not discover CommonJS exports re-exported through `export *`,
// leaving UILayoutType undefined while it registers Prefab script components.
export {
  activateUILayoutRuntime,
  createUIViewportSnapshot,
  deactivateUILayoutRuntime,
  registerUILayoutNode,
  UILayoutRuntime,
  UILayoutType,
} from "./UIViewport";
export type {
  UILayoutNode,
  UIRect,
  UIViewportMetrics,
  UIViewportSnapshot,
  UIViewportSource,
} from "./UIViewport";
