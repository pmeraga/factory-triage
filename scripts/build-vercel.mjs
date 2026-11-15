import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

// Vercel serves the application through api/index.mjs. Source and generated
// server files are excluded from the static output.
// Vercel rejects an entirely empty output folder, so it receives one fixed,
// harmless marker. The catch-all route runs before filesystem serving.
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
mkdirSync(".vercel-public", { recursive: true });
if (readdirSync(".vercel-public").some((name) => name !== "deployment.txt")) {
  throw new Error(
    "The Vercel static output may contain only deployment.txt. Remove unexpected files from .vercel-public before deploying.",
  );
}
writeFileSync(
  ".vercel-public/deployment.txt",
  "Factory Triage deployment marker. All application requests are handled by the application function.\n",
);
console.log(
  "Vercel build ready: public Node function; static output contains only a harmless deployment marker.",
);
