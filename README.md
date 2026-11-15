# Factory Triage

A manufacturing investigation workspace: find overdue work, inspect machine behavior, replay production history, and trace every exception to its source records.

[Open the application](https://factory-triage-psi.vercel.app) · [Source repository](https://github.com/pmeraga/factory-triage)

Public; no login required. Manufacturing records are read-only. The synthetic log contains **19,519 rows across 312 jobs**. Its default replay time is **August 13, 2026, 4:06:33 PM PDT**, the last source timestamp.

## Explore

- **Overview:** production time series, exclusive job-state distribution, recorded review signals, and an attention queue.
- **Machines:** preview asset activity, inspect cycle-duration points, drag to zoom, adjust a descriptive review threshold, export readings, or select a Pacific hour from the activity heatmap. Apply an asset scope to connect the other views.
- **Event stream:** metadata search, event-type facets, conflict filtering, sorting, pagination, time-bucket focus, and an inspector with original JSON, source lines, and conflicting variants. Export all matching events.
- **Jobs and quality:** sort jobs, inspect lifecycle and block history, compare up to four jobs, investigate source discrepancies, and keep personal review labels/notes with autosave and export.
- **Replay and personal views:** choose a preset/custom Pacific window, step through history, pin a browser-local watchlist, export its matching jobs, save views, and share analysis links. `⌘K` / `Ctrl+K` focuses the global search.

Shared links preserve analysis filters, time window, job sorting, and event-explorer filters/selection. Pins, personal investigation notes/review labels, and saved-view names stay in the current browser; shared links omit the private watchlist filter. Notes do not change recorded production status and are not synchronized; export them before clearing browser storage. Comparisons are session-local and clear when the analysis window changes.

## Run and verify

Requires **Node.js 24.x**.

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. The development server ingests and builds automatically, then rebuilds on source changes; refresh the browser after a rebuild.

```sh
npm test
npm run typecheck
npm run build
```

`npm run ingest` regenerates the normalized dataset independently. Tests cover normalization, replay boundaries, Pacific time, cohort filtering, API/export behavior, and UI-state helpers.

## Stack and decisions

**React 19, TypeScript, Vite, Lucide, and SVG** provide the dark telemetry workspace without chart-service dependencies. Node.js deterministically projects the JSONL source into an in-memory model; this small, immutable dataset does not need a separate database. Job state is reconstructed at the replay cursor, while telemetry counts only observations in the selected window.

A shared **Fetch API handler**, bundled with **esbuild**, serves the UI and read-only API locally and on **Vercel Node.js**. UI assets are embedded in the response. Source data and generated server bundles are excluded from static hosting. Browser storage holds pins, saved views, and personal investigation notes; the service accepts no data mutations.

## API and deployment

| GET route            | Result                                                                         |
| -------------------- | ------------------------------------------------------------------------------ |
| `/api/overview`      | Active job cohort, delivery/quality summaries, supporting-event checks         |
| `/api/telemetry`     | Windowed time series, machine metrics, cycle samples, states, signals, heatmap |
| `/api/events`        | Paginated source events and type/time facets                                   |
| `/api/events/:id`    | One source event in the selected scope/window                                  |
| `/api/jobs/:id`      | Job lifecycle and supporting events through `asOf`                             |
| `/api/export`        | Matching modeled jobs as CSV                                                   |
| `/api/events/export` | Every matching event as CSV                                                    |
| `/api/health`        | Service status and source-end timestamp                                        |

Analysis routes accept `search`, `customer`, `material`, `machine`, `facility`, `status`, `from`, and `asOf`. Time parameters use ISO timestamps with a timezone, such as `2026-07-20T18:00:00Z`; the UI displays Pacific time. Event queries additionally accept `eventSearch`, `eventType`, `conflictsOnly`, `sort`, `page`, and `pageSize` (maximum 200). Job details accept `asOf`.

Vercel deploys `main` using the committed [vercel.json](vercel.json): Node 24, `npm run vercel-build`, and a catch-all route to `api/index.mjs`. That command prepares the server bundle and a static-output directory containing only a deployment marker. No environment variables are required.

This is recorded history, not a live sensor feed or a causal diagnosis. P90 thresholds are descriptive, chart samples are disclosed, and conflicting quantities stay unresolved. See [DATA_NOTES.md](DATA_NOTES.md) for metric definitions, scope rules, and analytical limits.
