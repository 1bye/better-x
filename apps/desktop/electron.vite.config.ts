import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..", "..");
const appSource = path.resolve(directory, "src");

export default {
  main: {
    build: {
      outDir: "dist/main",
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        external: ["electron"],
        input: {
          shell: path.resolve(directory, "src", "preload", "shell.ts"),
          "x-feed": path.resolve(
            directory,
            "src",
            "feature",
            "x-workspace",
            "preload",
            "x-feed.ts"
          ),
        },
        output: {
          entryFileNames: "[name].js",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    build: {
      outDir: "dist/renderer",
    },
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@": appSource,
      },
    },
    server: {
      fs: {
        allow: [repositoryRoot],
      },
    },
  },
};
