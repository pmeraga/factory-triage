import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { watch, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
let worker = await import(
  pathToFileURL(resolve("dist/server/index.js")).href + "?v=" + Date.now()
);
const port = Number(process.env.PORT || 4173);
const server = createServer(async (req, res) => {
  try {
    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        requestHeaders.set(
          key,
          Array.isArray(value) ? value.join(", ") : value,
        );
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: requestHeaders,
    });
    const response = await worker.default.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Local server error");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local: http://127.0.0.1:${port}`),
);
let timer,
  building = false,
  pending = false;
async function rebuild() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  try {
    execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
    worker = await import(
      pathToFileURL(resolve("dist/server/index.js")).href + "?v=" + Date.now()
    );
    console.log("Rebuilt. Refresh the browser to see changes.");
  } catch {
    console.error("Build failed; previous version continues serving.");
  } finally {
    building = false;
    if (pending) {
      pending = false;
      rebuild();
    }
  }
}
for (const directory of ["src", "scripts"])
  watch(directory, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 400);
  });
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
