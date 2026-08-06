import { createContext, use } from "react";

export interface LiquidMenuStackContextValue {
  readonly baseSurfaceZIndex: number;
  readonly hideLayer: (layerId: string) => void;
  readonly layerIds: readonly string[];
  readonly portalContainer: HTMLElement | null;
  readonly showLayer: (layerId: string) => void;
}

export const LiquidMenuStackContext =
  createContext<LiquidMenuStackContextValue | null>(null);

export const useLiquidMenuStack = (): LiquidMenuStackContextValue => {
  const context = use(LiquidMenuStackContext);
  if (!context) {
    throw new Error(
      "Liquid menu roots must be used inside LiquidMenuStackProvider."
    );
  }
  return context;
};
