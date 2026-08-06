import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-xss"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeClassNames(clsx(inputs));
}
