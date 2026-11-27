# Switchboard

Switchboard receives Pigeon messages, queues durable replies and provides an authenticated, workspace-scoped inbox API with WebSocket replay.

## Start locally

Install Node.js 22 and start Docker Desktop or Docker Engine. From the repository root, install dependencies and start the data stores and simulators:

```sh
npm ci
npm run up
```

In a second terminal, start the backend:

```sh
npm start
```

In a third terminal, start the React dashboard:

```sh
npm run dev:web
```

Open http://localhost:5173 and choose **Sign in to Switchboard**. Select any test account on the mock IdP. Eli Novak can switch between Acme and Globex. The inbox lists recent conversations, with open and closed filters and a contact filter for loaded rows. Select a conversation to view messages, claim it, reply, close it, or reopen it according to your role. On mobile, the menu contains workspace selection and sign-out.

Run `npm run inbound` from a separate terminal to generate a Pigeon message. Select the resulting conversation and send a reply to see its delivery status update. To check reconnect, take the browser offline, generate another incoming message, then restore the connection. The inbox refreshes automatically and resumes from the last sequence it processed for that workspace. Drafts stay in memory while the dashboard is open, including across workspace switches. If a send cannot be confirmed, **Retry send** reuses its original reference.

If MongoDB and Redis already run locally, use `npm run mocks` in its own terminal in place of `npm run up`. Run `npm run doctor` to check the dependencies and `GET /healthz` to verify backend readiness. The backend starts without a local `.env` using the defaults in `.env.example`. Use a root `.env` file or environment variables to override them. `PORT` controls the backend listener and Vite's proxy target.

`npm run build:web` outputs the production dashboard to `frontend/dist`. Serve that directory from the frontend origin and proxy `/auth`, `/api`, and `/ws` to the backend, preserving WebSocket upgrades. Set `WEB_ORIGIN` and register the exact `OIDC_REDIRECT_URI` with the IdP. An HTTPS callback URI enables Secure cookies.

## API and WebSocket

| Method and path | Behavior |
| --- | --- |
| `GET /auth/login` | Starts OpenID Connect with PKCE. |
| `GET /auth/callback` | Sets the session cookie and redirects to `WEB_ORIGIN`. |
| `POST /auth/logout` | Revokes the shared session and clears the cookie. |
| `GET /api/me` | Returns `{ sub, workspaces: [{ id, role }] }`. |
| `GET /api/conversations` | Lists conversations, newest activity first. |
| `GET /api/conversations/:contact` | Returns conversation details. |
| `GET /api/conversations/:contact/messages` | Returns a page of messages, oldest first within the page. Offset zero selects the latest page. |
| `POST /api/conversations/:contact/claim` | Claims for the signed-in user. Returns 409 if another agent holds the conversation. |
| `POST /api/conversations/:contact/reply` | Accepts JSON `{ text, client_ref }`. Returns 202 when the reply is durable. A repeat of the same workspace reference reuses the original reply. |
| `POST /api/conversations/:contact/close` and `…/reopen` | Change conversation state. Agents may act on unassigned conversations or their own. Workspace admins may act on any conversation in their workspace. |

Conversation routes require `?workspace=<id>` and the session cookie. Encode the contact as a path segment. Paginated routes accept `limit` (1–100, default 25) and `offset` (default 0), and return `next_offset` when there is another page.

Connect to `/ws?workspace=<id>` with the session cookie for new events. On reconnect, add `&after=<last processed seq>` to replay missed events and continue live. Keep the last processed sequence per workspace. Sessions and replay across backends require shared Redis 7 or newer. Configure Redis persistence and no eviction for session and event keys in deployments that must survive Redis restarts.

## Verify

Stop any manually running backend on ports 4000 and up before running the checker. It starts its own backends and resets application inbox data.

```sh
npm run test:reliability
npm run check -- --levels 2,3
npm run check -- --levels 5
npm run check:full
```

The focused tests use a temporary MongoDB database and Redis logical database 15 by default. Run them with an isolated Redis database. Set `SWITCHBOARD_TEST_MONGO_URL` or `SWITCHBOARD_TEST_REDIS_URL` to target other test services. The suite covers signed webhook responses, duplicate and pending event publication, overlapping Retry-After windows, and a reply accepted by the carrier immediately before a worker dies.

Run the crash checks under Linux, including WSL or a Linux container on Windows, so the checker's POSIX process-group signals kill the backend processes. For container runs, stage the application and its dependencies on the Linux filesystem and keep Pigeon webhooks on the same network as the checker. The full checker writes `CHECK_REPORT.json` with its public scores. Level 4 uses a private checker.
