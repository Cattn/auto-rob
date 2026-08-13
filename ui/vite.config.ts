import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { functionsMixins } from "vite-plugin-functions-mixins";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    functionsMixins({ deps: ["m3-svelte"] }),
  ],
  optimizeDeps: {
    exclude: ["m3-svelte"],
  },
  ssr: {
    noExternal: ["m3-svelte"],
  },
});
