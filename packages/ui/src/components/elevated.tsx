"use client";

import { SURFACE_BG, surfaceClasses } from "@better-x/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@better-x/ui/lib/surface-context";
import { cn } from "@better-x/ui/utils/class-names";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from "react";

interface ElevatedProps extends ComponentPropsWithoutRef<"div"> {
  children?: ReactNode;
  /**
   * Steps above the current substrate.
   *
   * The component's own surface level becomes `min(substrate + offset, 8)`
   * and is re-provided to descendants so further nesting walks up the ladder.
   */
  offset: number;
  /**
   * Override for the shadow level. Defaults to the computed surface level;
   * pass `false` when surface color alone should communicate elevation.
   */
  shadowLevel?: false | number;
}

const Elevated = forwardRef<HTMLDivElement, ElevatedProps>(
  ({ offset, shadowLevel, className, children, ...props }, ref) => {
    const substrate = useSurface();
    const level = Math.min(substrate + offset, 8);
    const elevationClasses =
      shadowLevel === false
        ? SURFACE_BG[level]
        : surfaceClasses(level, shadowLevel ?? level);
    return (
      <SurfaceProvider value={level}>
        <div className={cn(elevationClasses, className)} ref={ref} {...props}>
          {children}
        </div>
      </SurfaceProvider>
    );
  }
);
Elevated.displayName = "Elevated";

export { Elevated };
