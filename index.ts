import { runPortfolio } from "./run.js";
import { resolveCliWorkspace } from "./workspace.js";

const root = resolveCliWorkspace(import.meta.url);

runPortfolio(root)
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
