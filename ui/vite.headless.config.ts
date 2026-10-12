import { defineConfig, mergeConfig } from "vite";
import mainConfig from "./vite.main.config";

export default mergeConfig(mainConfig, defineConfig({
  build: {
    target: "node22",
    outDir: "headless",
    lib: {
      entry: "../cli-entry.ts",
      fileName: "cli",
    },
  },
}));
