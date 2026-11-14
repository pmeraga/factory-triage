import dataset from "../.generated/data.json";
import { page } from "../.generated/page";
import { filterJobs, overviewFor } from "./domain.mjs";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });
  }
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(request.method === "HEAD" ? null : page, {
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/favicon.svg") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#143b32"/><path d="M18 17h29v9H29v8h15v9H29v10H18z" fill="#daf582"/></svg>',
        { headers: { ...headers, "Content-Type": "image/svg+xml" } },
      );
    }
    if (url.pathname === "/api/overview")
      return json(overviewFor(dataset, url.searchParams));
    if (url.pathname === "/api/health")
      return json({ ok: true, service: "factory-triage", asOf: dataset.asOf });
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const id = decodeURIComponent(jobMatch[1]);
      const job = dataset.jobs.find((j: { id: string }) => j.id === id);
      if (!job) return json({ error: "Job not found" }, 404);
      return json({
        job,
        events: (dataset.eventsByJob as any)[id] ?? [],
        blockIntervals: (dataset.blockIntervalsByJob as any)[id] ?? [],
      });
    }
    if (url.pathname === "/api/export") {
      const jobs = filterJobs(dataset.jobs, url.searchParams);
      const columns = [
        "id",
        "customerId",
        "partId",
        "material",
        "facility",
        "priority",
        "status",
        "dueAt",
        "createdAt",
        "startedAt",
        "completedAt",
        "overdue",
        "overdueHours",
        "blockReason",
        "blockedHours",
        "targetQuantity",
        "goodQuantity",
        "scrapQuantity",
        "qualityMismatch",
        "eventCount",
      ];
      const csv = [
        columns.map(csvCell).join(","),
        ...jobs.map((job: Record<string, unknown>) =>
          columns.map((key) => csvCell(job[key])).join(","),
        ),
      ].join("\r\n");
      return new Response(csv, {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="factory-triage-jobs.csv"',
        },
      });
    }
    return json({ error: "Route not found" }, 404);
  } catch (error) {
    console.error(
      "Request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return json(
      { error: "Unable to process this request. Please try again." },
      500,
    );
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const response = await handleRequest(request);
    return request.method === "HEAD"
      ? new Response(null, {
          status: response.status,
          headers: response.headers,
        })
      : response;
  },
};
