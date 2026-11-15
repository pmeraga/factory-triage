import dataset from "../.generated/data.json";
import { page } from "../.generated/page";
import { filterJobs } from "./domain.mjs";
import {
  QueryError,
  resolveContext,
  overviewForContext,
  telemetryFor,
  eventsFor,
  eventFor,
  eventsForExport,
} from "./telemetry.mjs";
import { formatPacific, DISPLAY_TIME_ZONE } from "./time.mjs";

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
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#121a24"/><path d="M17 17l31-8v10l-31 8zm0 16l24-6v10l-24 6zm0 16l16-4v10l-16 4z" fill="#53d6df"/></svg>',
        { headers: { ...headers, "Content-Type": "image/svg+xml" } },
      );
    }
    if (url.pathname === "/api/overview")
      return json(overviewForContext(dataset, url.searchParams));
    if (url.pathname === "/api/telemetry")
      return json(telemetryFor(dataset, url.searchParams));
    if (url.pathname === "/api/events")
      return json(eventsFor(dataset, url.searchParams));
    if (url.pathname === "/api/events/export") {
      const events = eventsForExport(dataset, url.searchParams);
      const columns = [
        "event_id",
        "timestamp_utc",
        "timestamp_pacific",
        "event_type",
        "job_id",
        "part_id",
        "customer_id",
        "machine_id",
        "material",
        "quantity",
        "quantity_conflict",
        "defect_code",
        "reason",
        "source_lines",
      ];
      const rows = events.map((event: any) => [
        event.event_id,
        event.timestamp,
        formatPacific(event.timestamp, true),
        event.event_type,
        event.job_id,
        event.part_id,
        event.customer_id,
        event.machine_id,
        event.material,
        event.quantity,
        Boolean(event.conflict),
        event.metadata?.defect_code,
        event.metadata?.reason,
        event.sourceLineNumbers?.join(";"),
      ]);
      const csv = [columns, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n");
      return new Response(csv, {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="factory-triage-events.csv"',
        },
      });
    }
    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (eventMatch) {
      let id: string;
      try {
        id = decodeURIComponent(eventMatch[1]);
      } catch {
        return json({ error: "Invalid event identifier" }, 400);
      }
      const event = eventFor(dataset, id, url.searchParams);
      return event
        ? json({ event })
        : json(
            { error: "Event not found in the selected scope and time window" },
            404,
          );
    }
    if (url.pathname === "/api/health")
      return json({
        ok: true,
        service: "factory-triage",
        asOf: dataset.asOf,
        timezone: DISPLAY_TIME_ZONE,
      });
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      let id: string;
      try {
        id = decodeURIComponent(jobMatch[1]);
      } catch {
        return json({ error: "Invalid job identifier" }, 400);
      }
      const cursorParams = new URLSearchParams();
      if (url.searchParams.get("asOf"))
        cursorParams.set("asOf", url.searchParams.get("asOf")!);
      else if (url.searchParams.get("to"))
        cursorParams.set("asOf", url.searchParams.get("to")!);
      const { dataset: snapshot, window } = resolveContext(
        dataset,
        cursorParams,
      );
      const job = snapshot.jobs.find((j: { id: string }) => j.id === id);
      if (!job) return json({ error: "Job not found" }, 404);
      return json({
        job,
        asOf: window.to,
        events: (snapshot.eventsByJob as any)[id] ?? [],
        blockIntervals: (snapshot.blockIntervalsByJob as any)[id] ?? [],
      });
    }
    if (url.pathname === "/api/export") {
      const { dataset: snapshot, window } = resolveContext(
        dataset,
        url.searchParams,
      );
      const jobs = filterJobs(snapshot.jobs, url.searchParams);
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
        "createdAtPacific",
        "startedAt",
        "startedAtPacific",
        "completedAt",
        "completedAtPacific",
        "dueAtPacific",
        "snapshotAt",
        "snapshotAtPacific",
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
          columns
            .map((key) => {
              if (key === "snapshotAt") return csvCell(window.to);
              if (key === "snapshotAtPacific")
                return csvCell(formatPacific(window.to, true));
              if (key.endsWith("Pacific"))
                return csvCell(
                  job[key.slice(0, -7)]
                    ? formatPacific(job[key.slice(0, -7)], true)
                    : "",
                );
              return csvCell(job[key]);
            })
            .join(","),
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
    if (error instanceof QueryError) return json({ error: error.message }, 400);
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
