import { WasmRuntime, type WasmByteProvider, type WasmRuntimeLoadOptions } from "./WasmRuntime";

export interface WasmCapability {
  load(options: WasmRuntimeLoadOptions): Promise<WasmRuntime>;
}

export function createWasmCapability(defaultLoadBytes?: WasmByteProvider): WasmCapability {
  return {
    load(options) {
      return WasmRuntime.load(
        options.loadBytes !== undefined || defaultLoadBytes === undefined
          ? options
          : { ...options, loadBytes: defaultLoadBytes },
      );
    },
  };
}

export const wasmCapability: WasmCapability = createWasmCapability();
