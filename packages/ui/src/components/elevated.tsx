"use client";

import { surfaceClasses } from "@better-x/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@better-x/ui/lib/surface-context";
import { cn } from "@better-x/ui/lib/utils";
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
   * Override for the shadow level. Defaults to the computed surface level.
   */
  shadowLevel?: number;
}

const Elevated = forwardRef<HTMLDivElement, ElevatedProps>(
  ({ offset, shadowLevel, className, children, ...props }, ref) => {
    const substrate = useSurface();
    const level = Math.min(substrate + offset, 8);
    return (
      <SurfaceProvider value={level}>
        <div
          className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      </SurfaceProvider>
    );
  }
);
Elevated.displayName = "Elevated";

export { Elevated };
