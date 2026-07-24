import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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
  assetsInclude: ["**/*.md", "**/.env.example"],
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
    alias: {
      "cross-spawn": path.dirname(require.resolve("cross-spawn/package.json")),
      which: path.dirname(require.resolve("which/package.json")),
    },
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
