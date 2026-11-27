# Switchboard decisions

**Scope.** The React dashboard supports OIDC sign-in, workspace selection, a paginated inbox, reply status, claims, close/reopen and live updates. Billing, Elasticsearch and encrypted notes were excluded to focus on the inbox and recovery.

**Persistence and recovery.** MongoDB enforces per-workspace deduplication and atomic claims. Replies and events are persisted with their originating writes. Leased workers send replies with stable Pigeon idempotency keys. The first terminal status wins. Redis shares the rate limit and cooldown, and its Streams assign sequences for replay. The dashboard refreshes HTTP reads on events. Grader reset clears inbox state and replay history while preserving sessions and sequence counters.

**Access.** OIDC uses S256 PKCE, one-use browser-bound state and nonce, and signed claim validation. Redis sessions use HttpOnly cookies. Workspace roles govern API and socket access. Agents can close or reopen unassigned or self-assigned threads. Admins can do so across their workspace. Closing preserves assignment and allows replies. Browser mutations check Origin, and the carrier client rejects redirects.

**Verification.** The first crash baseline scored 33/36. With a Windows bind mount and host-routed callbacks, it stored 34/171 inbound messages during Level 2. The unchanged application scored 36/36 with a Linux-local checkout and Pigeon on loopback. A focused test exposed a shorter Retry-After overwriting a longer cooldown, which now extends atomically. See [CHECK_REPORT.json](CHECK_REPORT.json) for the latest public scores. The private Level 4 checker was unavailable.

**Limits.** Pigeon's finite webhook retry window bounds inbound recovery. Provider resets can erase idempotency keys. Replay across Redis crashes depends on Redis persistence, and the stream has no automatic retention cap. IdP membership changes take effect at the next sign-in or session expiry. Inbox filters cover loaded pages, and reply drafts and cursors stay in memory.
