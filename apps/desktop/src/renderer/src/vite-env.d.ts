/// <reference types="vite/client" />

import type { DesktopApi } from "../../feature/x-workspace/lib/desktop-api.js";

declare global {
  interface Window {
    readonly betterX: DesktopApi;
  }
}
