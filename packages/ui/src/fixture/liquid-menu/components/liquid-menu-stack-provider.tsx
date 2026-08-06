import {
  LiquidMenuStackContext,
  type LiquidMenuStackContextValue,
} from "@better-x/ui/fixture/liquid-menu/hooks/use-liquid-menu-stack";
import {
  addLiquidMenuLayer,
  removeLiquidMenuLayer,
} from "@better-x/ui/fixture/liquid-menu/lib/liquid-menu-stack";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

interface LiquidMenuStackProviderProps {
  readonly baseSurfaceZIndex?: number;
  readonly children: ReactNode;
  readonly portalContainer?: HTMLElement | null;
}

export function LiquidMenuStackProvider({
  baseSurfaceZIndex = 41,
  children,
  portalContainer = null,
}: LiquidMenuStackProviderProps): ReactElement {
  const [layerIds, setLayerIds] = useState<readonly string[]>([]);
  const showLayer = useCallback((layerId: string): void => {
    setLayerIds((currentLayerIds) =>
      addLiquidMenuLayer(currentLayerIds, layerId)
    );
  }, []);
  const hideLayer = useCallback((layerId: string): void => {
    setLayerIds((currentLayerIds) =>
      removeLiquidMenuLayer(currentLayerIds, layerId)
    );
  }, []);
  const context = useMemo<LiquidMenuStackContextValue>(
    () => ({
      baseSurfaceZIndex,
      hideLayer,
      layerIds,
      portalContainer,
      showLayer,
    }),
    [baseSurfaceZIndex, hideLayer, layerIds, portalContainer, showLayer]
  );

  return (
    <LiquidMenuStackContext value={context}>{children}</LiquidMenuStackContext>
  );
}
