import { runPortfolio } from "./run.js";
import { prepareCliWorkspace } from "./workspace.js";
import { loadEnvFile } from "./notify.js";

const root = await prepareCliWorkspace(import.meta.url);
await loadEnvFile(root);

runPortfolio(root)
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
