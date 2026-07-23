import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    description:
      "Turn X into a fast, mail-style split view with a live post reader.",
    name: "Better X Reader",
    permissions: ["storage"],
  },
  modules: ["@wxt-dev/module-react"],
});
