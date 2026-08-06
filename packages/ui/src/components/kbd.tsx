import { cn } from "@better-x/ui/lib/utils";
import type { ComponentProps } from "react";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5.5 w-fit min-w-5.5 select-none items-center justify-center gap-1 rounded-lg bg-muted px-1.5 font-medium text-muted-foreground text-xs [font-family:var(--font-kbd)]",
        className
      )}
      data-name="Kbd"
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-name="KbdGroup"
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
