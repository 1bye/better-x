import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    description:
      "Spotlight X posts and control the timeline from your keyboard.",
    host_permissions: ["https://x.com/*", "https://*.x.com/*"],
    name: "Better X Focus Mode",
    permissions: ["storage"],
  },
  modules: ["@wxt-dev/module-react"],
});
