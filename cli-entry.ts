import { runCli } from "./cli.js";
import packageInfo from "./ui/package.json" with { type: "json" };

runCli(process.argv.slice(2), packageInfo.version).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
