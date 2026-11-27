# Switchboard

Phase 1 implements Pigeon webhooks, durable replies, conversation claiming and the four grader endpoints.

Install Node.js 22. From a clean clone, run:

```sh
npm ci
npm run up
npm start
```

If MongoDB and Redis are already running, `npm run mocks` starts the supplied simulators without Docker. `npm run doctor` checks the dependencies. The server uses the values in `.env.example` by default. Copy it to `.env` only to override local settings. Export variables in the shell to override the values the checker supplies.

With the server running, use `npm run inbound` to send a sample message. `GET /healthz` checks MongoDB and Redis readiness. To run the basic Level 1 checker, stop the application and run `npm run check`. The checker starts the application itself and clears its data. On Windows, the checker expects a POSIX shell on PATH and uses POSIX process-group signals for cleanup and crash testing.

`npm run dev:web` starts the React/Vite shell. `npm run build:web` builds it.
