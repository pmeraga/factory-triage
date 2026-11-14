import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { build } from "esbuild";

execFileSync(process.execPath, ["scripts/ingest.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  stdio: "inherit",
});
mkdirSync(".generated", { recursive: true });
let html = readFileSync("dist-client/index.html", "utf8");
const scripts = [
  ...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g),
];
for (const [tag, source] of scripts) {
  const code = readFileSync(
    "dist-client/" + source.replace(/^\//, ""),
    "utf8",
  ).replace(/<\/script/gi, "<\\/script");
  html = html.replace(tag, () => `<script type="module">${code}</script>`);
}
for (const [tag, source] of [
  ...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g),
]) {
  html = html.replace(
    tag,
    () =>
      "<style>" +
      readFileSync("dist-client/" + source.replace(/^\//, ""), "utf8") +
      "</style>",
  );
}
html = html.replace(
  "</head>",
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg"/></head>',
);
writeFileSync(
  ".generated/page.ts",
  "export const page = " + JSON.stringify(html) + ";\n",
);
mkdirSync("dist/server", { recursive: true });
mkdirSync("dist/.openai", { recursive: true });
await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
});
cpSync(".openai/hosting.json", "dist/.openai/hosting.json");
const output = readFileSync("dist/server/index.js", "utf8");
if (!output.includes("fetch(") && !output.includes("fetch:"))
  throw new Error("Worker fetch handler missing");
console.log(
  `Worker built: ${(Buffer.byteLength(output) / 1024 / 1024).toFixed(2)} MB. Frontend embedded; no public data assets.`,
);
