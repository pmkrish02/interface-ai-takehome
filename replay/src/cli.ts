import * as fs from "fs";
import * as path from "path";
import { isArtifact } from "@interface-takehome/shared";
import { runReplay } from "./engine";

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

  if (!args.artifact) {
    console.error(
      'Usage: npm run replay -- --artifact evidence/artifacts/<name>.json --params \'{"username":"admin"}\''
    );
    process.exit(1);
  }

  const artifactPath = path.resolve(args.artifact);
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
  if (!isArtifact(raw)) {
    console.error(`${artifactPath} does not match the Artifact schema.`);
    process.exit(1);
  }
  const artifact = raw;

  const params = args.params ? JSON.parse(args.params) : {};

  const evidenceRoot = path.resolve(__dirname, "..", "..", "evidence");

  console.log(`Replaying: ${artifact.name} (${artifactPath})`);
  console.log(`Target: ${artifact.target.baseUrl} (tenant: ${artifact.target.tenant})`);

  const result = await runReplay(artifact, params, {
    evidenceRoot,
    headless: args.headless === "true",
  });

  console.log(`\nResult: ${result.status}`);
  switch (result.status) {
    case "success":
      console.log("Outputs:", JSON.stringify(result.outputs, null, 2));
      break;
    case "business_outcome":
      console.log("Outcome:", result.outcome);
      break;
    case "hard_failure":
      console.log(`Step ${result.step}`);
      console.log("Expected:", result.expected);
      console.log("Observed:", result.observed);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("Replay failed:", e);
  process.exit(1);
});
