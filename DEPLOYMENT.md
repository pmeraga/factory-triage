# Vercel deployment

- Production: https://factory-triage-psi.vercel.app
- Project: https://vercel.com/yotta-robotics/factory-triage
- Git repository: https://github.com/pmeraga/factory-triage
- Production branch: `main`
- Runtime: Node.js 24.x
- Build: `npm run vercel-build`

The application is public and read-only, with synthetic manufacturing data. The public production URL requires no login. GitHub pushes to `main` trigger production deployments; other branches can produce preview deployments.

The build generates the dataset and frontend, then bundles a Fetch API service at `dist/server/index.js`. Vercel's Node.js adapter in `api/index.mjs` forwards application requests to that service. The raw source dataset and generated server bundle are not served as static files.

Vercel requires a nonempty static output directory. The build writes only a harmless `deployment.txt` marker to `.vercel-public` and rejects other files. The catch-all route runs before filesystem handling, so even marker requests go through the application handler.

Release verification covers automated tests, TypeScript, and the Vercel provider build. Public smoke checks should return HTTP 200 for the app, overview API, a valid job API, and CSV export without credentials. Raw source, generated data, and server-bundle paths must return HTTP 404.
