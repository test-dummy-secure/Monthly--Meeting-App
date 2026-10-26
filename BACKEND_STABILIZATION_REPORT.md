# Backend Stabilization Report
**Date:** 2026-10-26
**Status:** ✅ Working, Stabilized Version — supersedes the 2026-06-04 report in full

> The previous version of this report documented an early prototype stage of
> the backend (mock JWT tokens, in-memory mock repositories, no real
> database). Every item listed under that report's "Next Steps (Phase 2)" has
> since been completed. This report reflects the actual current state of the
> system and the security/CI work done most recently.

---

## Executive Summary

1. ✅ **Real authentication** — bcrypt-hashed passwords, separate access/refresh JWT secrets, DB-backed refresh token storage, role-based access control
2. ✅ **Real database** — PostgreSQL, 51+ applied migrations, connection pooling via `pg`
3. ✅ **Real multi-tenant architecture** — tenant isolation via `tenant_assignments`, AM roster-aware (not just a single "primary" owner)
4. ✅ **Pluggable AI provider layer** — Ollama (local), OpenAI, and Claude, selectable via one config switch, with automatic fallback to local on cloud failure
5. ✅ **Real third-party integrations** — Microsoft 365 (OAuth, Calendar, Graph), Fireflies AI (meeting transcription), ClickUp (task sync), NXG360 (findings)
6. ✅ **Full Docker containerization** — backend, frontend, Postgres, Redis, all compose-orchestrated
7. ✅ **Self-published OpenAPI spec** (`/api/docs.json`) — used for both API documentation and automated security scanning
8. ✅ **4 automated security pipelines live in CI** — SAST, SCA, Secrets/SBOM, and DAST, all reporting into the NXG Secure (DefectDojo) portal
9. ✅ **Several real, confirmed vulnerabilities found and fixed** this cycle (see below) — not just pipeline plumbing

---

## Security Fixes Applied (this cycle)

These were found by Semgrep (SAST) and OWASP ZAP (DAST) against the real, running application — not theoretical findings.

| # | Issue | Severity | File(s) | Fix |
|---|---|---|---|---|
| 1 | Path traversal risk | Medium | `routes/meeting-logs.routes.js` | Validate `tenantId`/`meetingId` as well-formed UUIDs before use in `path.join` |
| 2 | Weak GCM decryption config | Medium | `utils/encryption.js`, `services/microsoft/MicrosoftTokenStore.js` | Explicit `authTagLength` on `createDecipheriv` |
| 3 | XSS via unescaped URL in email templates | Medium | `services/email.service.js` | Centralized scheme validation (`sanitizeUrlValue`) in the template renderer — covers all 6 affected email templates from one place |
| 4 | Hardcoded live admin credentials in source | **Critical** | `frontend/src/pages/Login.jsx`, `backend/src/database/seed.js`, `README.md` | Removed the dev "quick login" feature entirely; demo credentials de-coupled from the real admin account's password, before the repository was ever pushed to GitHub |
| 5 | Missing response caching controls | Low | `app.js` | Global `Cache-Control: no-store` — this is an API backend with no public cacheable assets |
| 6 | Multi-AM tenant visibility bug | — (functional, not security) | `routes/meeting.routes.js`, `repositories/calendar.repository.js`, `routes/fireflies.routes.js` | Fireflies/Microsoft 365 connection checks only recognized a tenant's *primary* AM; fixed to recognize any assigned AM |

---

## CI/CD Security Pipeline (GitHub Actions)

Four workflows run automatically on every pull request:

| Workflow | Checks | Status |
|---|---|---|
| **SAST** (code check) | Semgrep static analysis against the real source | ✅ Passing |
| **SCA** (dependency check) | Known-vulnerability scan of all npm dependencies | ✅ Passing |
| **Secrets / SBOM** | Leaked-credential scan + software bill of materials | ✅ Passing |
| **DAST** (dynamic scan) | OWASP ZAP against a live, running copy of the app | ✅ Passing — see below |

### DAST pipeline — built out this cycle

The dynamic scan now:
1. Spins up a complete, disposable copy of the full stack (Postgres, Redis, backend, frontend) inside the CI runner itself
2. **Logs in for real** using a test account, so the scan covers authenticated/protected routes, not just public ones
3. Runs two scans: a general baseline scan, and a second scan **driven directly by the application's own OpenAPI spec** (`/api/docs.json`) — this is what gives it real route-by-route coverage instead of relying on link-crawling (which doesn't work against a JSON API with no clickable pages)
4. Uploads both reports to the NXG Secure (DefectDojo) portal automatically

**Real, measured result:** endpoint coverage in the security portal went from **1 host / 3 endpoints** (before the OpenAPI-driven scan existed — ZAP could only find generic paths like `/robots.txt`) to **1 host / 115 real endpoints** (the actual API surface of the application).

**Scope note:** this pipeline currently scans the **backend only** (port 5000). The frontend (the UI pages a person actually clicks through) is built and started in CI but not yet scanned — that would need a separate, traditional link-crawling scan against port 80, which hasn't been built yet.

---

## Architecture — Current State

### Backend Stack
- **Runtime:** Node.js 20 (upgraded from 18 this cycle — a dependency, `pdf-parse`, requires Node ≥20; Node 18 was also already past its own end-of-life)
- **Framework:** Express
- **Database:** PostgreSQL via `pg`, connection-pooled
- **Queue/Cache:** Redis + BullMQ (background jobs: transcript fetching, reminders, escalations, carry-forward)
- **Containerization:** Docker, multi-stage builds, orchestrated via `docker-compose.yml`

### Authentication & Authorization
- bcrypt password hashing (12 rounds)
- Separate signing secrets for access vs. refresh tokens, both required to be strong, random values in production (enforced by a startup validator — the app refuses to boot with weak/default secrets)
- Refresh tokens persisted and revocable
- Role-based access: `super_admin`, `account_manager`
- Tenant isolation enforced per-request via `tenant.middleware.js`

### AI Processing Layer
- Pluggable provider architecture (`services/ai/providerFactory.js`) — Ollama (local), OpenAI, or Claude, switchable via a single `AI_PROVIDER` environment variable, no code changes needed
- Automatic fallback to local Ollama if a cloud provider errors or rate-limits
- Used for: meeting transcript structuring, post-meeting task/recommendation generation, AI-assisted findings analysis

### Integrations
| Integration | Purpose | Auth model |
|---|---|---|
| Microsoft 365 / Graph | Calendar events, Teams meeting links, email delivery | OAuth2, per-AM user-scoped tokens |
| Fireflies AI | Automatic meeting transcription | Per-AM API key, user-scoped |
| ClickUp | Remediation task sync | Per-tenant API token |
| NXG360 | Security findings ingestion | Per-tenant encrypted API connection |
| NXG Secure (DefectDojo) | Security scan result aggregation | Platform API token (CI-only) |

### Route Modules (backend/src/app.js)
`auth`, `nxg360`, `customers`, `meetings`, `tasks`, `meeting-logs`, `integrations`, `analytics`, `findings`, `tenants`, `tracker`, `reports`, `audit-logs`, `ai`, `action-items`, `providers`, `fireflies`, `clickup`, `monitoring`, `notifications`, `ms-oauth` (Microsoft 365), plus a `dev`-only route module that's never mounted in production.

### Middleware Stack (order-sensitive)
```
1. Correlation ID (request tracing)
2. Helmet (security headers, CSP)
3. Cache-Control: no-store (all responses)
4. Compression
5. CORS (explicit allowlist, no wildcard)
6. Public routes (no auth — webhooks, task confirmation links)
7. JSON/urlencoded body parsing
8. HTTP request logging
9. Global rate limiting
10. Request timeout
11. [route-specific auth middleware]
12. 404 handler
13. Global error handler
```

---

## GitHub Repository

- Connected and pushed: `test-dummy-secure/bmmj`
- All credential hygiene enforced **before** the first push — no real secrets, including a previously-hardcoded live admin password, ever reached git history
- `.env`/`.env.production` correctly gitignored throughout

---

## Known Gaps / Next Steps

- [ ] Frontend (UI) is not yet covered by any DAST scan — only the backend API is scanned today
- [ ] The "Application Error Disclosure" finding from the latest DAST scan (malformed IDs on routes like `/api/customers/:id` return a raw `500` instead of a clean `400`) is a real, minor fix still outstanding
- [ ] Automated test coverage (unit/integration) is not yet established for the fixes made this cycle
