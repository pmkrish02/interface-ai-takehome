import * as path from "path";
import { runDiscovery } from "./loop";
import type { DiscoveryConfig } from "./types";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = value;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.goal) {
    console.error('Usage: npm run discover -- --goal "look up member 12345 and read their savings balance"');
    process.exit(1);
  }

  const config: DiscoveryConfig = {
    goal: args.goal,
    baseUrl: args["target-url"] ?? "http://localhost:3000",
    app: args.app ?? "mock-bank",
    tenant: args.tenant ?? "default",
    credentials: {
      username: args.username ?? "admin",
      password: args.password ?? "password123",
    },
    maxSteps: args["max-steps"] ? Number(args["max-steps"]) : 15,
    perStepTimeoutMs: args["step-timeout-ms"] ? Number(args["step-timeout-ms"]) : 20000,
    headless: args.headless === "true",
    artifactName: args["artifact-name"],
  };

  const evidenceRoot = path.resolve(__dirname, "..", "..", "evidence");

  console.log(`Discovering: "${config.goal}"`);
  console.log(`Target: ${config.baseUrl} (tenant: ${config.tenant})`);

  const result = await runDiscovery(config, evidenceRoot);

  console.log(`\nStop reason: ${result.stopReason}`);
  console.log(`Artifact: ${path.join(result.artifactsDir, `${result.artifact.name}.json`)}`);
  console.log(`Steps recorded: ${result.artifact.steps.length}`);
  console.log(`Parameters: ${result.artifact.parameters.map((p) => p.name).join(", ") || "none"}`);
  console.log(`Outputs: ${result.artifact.outputs.map((o) => o.name).join(", ") || "none"}`);

  if (result.stopReason !== "done") {
    console.error(`\nDiscovery did not complete cleanly (stopReason=${result.stopReason}).`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Discovery failed:", e);
  process.exit(1);
});
