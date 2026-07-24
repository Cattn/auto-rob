import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const builtins = [
  "electron",
  "electron/common",
  "electron/main",
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

export default defineConfig({
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  assetsInclude: ["**/*.md"],
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
  build: {
    outDir: ".vite/build",
    lib: {
      formats: ["es"],
      entry: "electron/main.ts",
      fileName: "main",
    },
    rollupOptions: {
      external: builtins,
    },
  },
});
