# Vercel deployment

- Production: https://factory-triage-psi.vercel.app
- Project: https://vercel.com/yotta-robotics/factory-triage
- Git repository: https://github.com/pmeraga/factory-triage
- Production branch: `main`
- Runtime: Node.js 24.x
- Build: `npm run vercel-build`

The application is public and read-only, with synthetic manufacturing data. No login is required on Production or Preview. The API adapter forwards application requests to the Worker handler; neither the raw source dataset nor the generated server bundle is served as a static file.

Vercel requires a nonempty static output directory. The build writes only a harmless `deployment.txt` marker to `.vercel-public` and rejects other files. The catch-all route runs before filesystem handling, so even marker requests go through the application handler.

Git deployments require a commit author with project access. This checkout uses the authorized `pmeraga` GitHub account's noreply email in repository-local Git configuration. Other repositories' Git settings are unchanged.

Release verification covers automated tests, TypeScript, and the Vercel provider build. Public smoke checks should return HTTP 200 for the app, overview API, a valid job API, and CSV export without credentials. Raw source, generated data, and server-bundle paths must return HTTP 404.
