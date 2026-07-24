/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.json?raw" {
  const content: string;
  export default content;
}
