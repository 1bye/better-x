import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";
import { startFocusMode } from "../feature/focus-mode/lib/start-focus-mode";
import { startImageEditor } from "../feature/image-editor/lib/x-image-editor";

const startExtension = async (ctx: ContentScriptContext): Promise<void> => {
  startImageEditor(ctx);
  await startFocusMode(ctx);
};

export default defineContentScript({
  main: startExtension,
  matches: ["*://x.com/*", "*://*.x.com/*"],
  runAt: "document_idle",
});
