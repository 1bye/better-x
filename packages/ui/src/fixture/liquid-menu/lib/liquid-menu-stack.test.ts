import { describe, expect, test } from "bun:test";
import { LIQUID_MENU_MOTION } from "@better-x/ui/fixture/liquid-menu/constants/liquid-menu";
import {
  addLiquidMenuLayer,
  getLiquidMenuBackdropOpacity,
  getLiquidMenuLayerZIndices,
  removeLiquidMenuLayer,
} from "@better-x/ui/fixture/liquid-menu/lib/liquid-menu-stack";

describe("liquid menu stack", () => {
  test("preserves registration order without duplicating layers", () => {
    const rootLayers = addLiquidMenuLayer([], "root");
    const nestedLayers = addLiquidMenuLayer(rootLayers, "nested");

    expect(addLiquidMenuLayer(nestedLayers, "root")).toBe(nestedLayers);
    expect(nestedLayers).toEqual(["root", "nested"]);
    expect(removeLiquidMenuLayer(nestedLayers, "nested")).toEqual(["root"]);
  });

  test("places each child scrim above its parent content", () => {
    const parent = getLiquidMenuLayerZIndices(0);
    const child = getLiquidMenuLayerZIndices(1);

    expect(parent.surface).toBeLessThan(parent.content);
    expect(parent.content).toBeLessThan(child.surface);
    expect(child.surface).toBeLessThan(child.content);
  });

  test("supports elevated host stacking contexts", () => {
    const parent = getLiquidMenuLayerZIndices(0, 2_147_483_100);

    expect(parent.surface).toBe(2_147_483_100);
    expect(parent.content).toBe(2_147_483_101);
  });

  test("renders one constant nested scrim while root scrims follow motion", () => {
    expect(
      getLiquidMenuBackdropOpacity({
        hasLayerBelow: false,
        isTopLayer: true,
        progress: 0.5,
      })
    ).toBe(LIQUID_MENU_MOTION.backdropOpacity * 0.5);
    expect(
      getLiquidMenuBackdropOpacity({
        hasLayerBelow: true,
        isTopLayer: true,
        progress: 0.01,
      })
    ).toBe(LIQUID_MENU_MOTION.backdropOpacity);
    expect(
      getLiquidMenuBackdropOpacity({
        hasLayerBelow: false,
        isTopLayer: false,
        progress: 1,
      })
    ).toBe(0);
  });
});
