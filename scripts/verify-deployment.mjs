import assert from "node:assert/strict";

// Pass {url, username, password} over stdin; never put credentials in argv.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log(
  "Ready for deployment verification JSON on stdin (input is hidden).",
);
const input = await new Promise((resolve) => {
  let buffer = "";
  const read = (chunk) => {
    buffer += chunk.toString();
    if (buffer.includes("\u0003")) process.exit(130);
    if (buffer.includes("\n")) {
      process.stdin.removeListener("data", read);
      resolve(buffer.slice(0, buffer.indexOf("\n")));
    }
  };
  process.stdin.on("data", read);
  process.stdin.resume();
});
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
const { url, username, password } = JSON.parse(input);
const origin = new URL(url).origin;
const authorization =
  "Basic " + Buffer.from(username + ":" + password).toString("base64");
const get = (path, auth = null) =>
  fetch(origin + path, {
    redirect: "manual",
    headers: auth ? { Authorization: auth } : {},
    signal: AbortSignal.timeout(30000),
  });
const checks = [];
for (const path of [
  "/",
  "/api/overview",
  "/api/jobs/job_0220",
  "/api/export",
  "/favicon.svg",
]) {
  const response = await get(path);
  assert.equal(response.status, 401, `Unauthenticated ${path}`);
  assert.match(response.headers.get("www-authenticate") ?? "", /Basic/);
  checks.push({ route: path, unauthenticatedStatus: response.status });
}
const html = await get("/", authorization);
assert.equal(html.status, 200);
assert.match(await html.text(), /Factory Triage/);
const response = await get("/api/overview", authorization);
assert.equal(response.status, 200);
const overview = await response.json();
assert.equal(overview.stats.jobs, 312);
assert.equal(overview.stats.overdueOpen, 26);
assert.equal(overview.stats.blockedOpen, 9);
assert.equal(overview.dataQuality.conflictingIds.length, 5);
const detail = await (await get("/api/jobs/job_0220", authorization)).json();
assert.equal(detail.job.blockReason, "missing_tool");
const csvResponse = await get("/api/export?status=blocked", authorization);
assert.equal(csvResponse.status, 200);
assert.equal((await csvResponse.text()).split("\r\n").length - 1, 9);
console.log(
  JSON.stringify(
    {
      url: origin,
      status: "verified",
      checks,
      authenticated: {
        html: 200,
        api: 200,
        jobDetail: "verified",
        blockedCsvJobs: 9,
      },
      stats: overview.stats,
    },
    null,
    2,
  ),
);
