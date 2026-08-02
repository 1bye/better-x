import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    description:
      "Turn X into a mail-style split view with official embedded posts.",
    host_permissions: ["https://x.com/*", "https://*.x.com/*"],
    name: "Better X Reader",
    permissions: ["storage"],
  },
  modules: ["@wxt-dev/module-react"],
});
