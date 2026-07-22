import spawn from "cross-spawn";
import { resolveAgentCommand } from "./resolve-agent.js";

const agent = await resolveAgentCommand();
console.log(`resolved: ${agent}`);
console.log(`platform: ${process.platform}`);

const child = spawn(agent, ["--version"], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let out = "";
child.stdout?.setEncoding("utf8");
child.stderr?.setEncoding("utf8");
child.stdout?.on("data", (chunk: string) => {
  out += chunk;
});
child.stderr?.on("data", (chunk: string) => {
  out += chunk;
});

const code = await new Promise<number>((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (exitCode) => resolve(exitCode ?? 1));
});

const version = out.trim();
if (code !== 0 || !version) {
  console.error(`agent --version failed (exit ${code}): ${version || "(empty)"}`);
  process.exit(1);
}

console.log(`version: ${version}`);
console.log("ok");
