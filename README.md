# BMMJ — Business Meeting Management Journey

An enterprise-grade platform built for MSSPs (Managed Security Service Providers) to orchestrate monthly security review meetings with enterprise customers end-to-end — from scheduling and pre-meeting intelligence through conducted sessions, Teams transcript import, remediation tracking, and automated reporting.

Built by **NXG Secure**.

---

## How It Works

```
Schedule meeting → T-48 fires → AI recommendations → AM approves
    → Send Calendly booking link → Customer books via Microsoft Calendar
    → System auto-detects booking → Meeting auto-conducts at end time + 15 min
    → Teams transcript imported → Post-meeting email to AM
    → Tasks tracked across meetings → Carry-forward / escalation / weekly reports
    → AM closes meeting → Next month auto-scheduled
```

1. A monthly meeting is created per customer tenant
2. **T-48**: 48 hours before the meeting, the system pulls live NXG360 security findings and generates AI-recommended remediation tasks via Ollama
3. The AM reviews the pre-meeting brief, exports it as a PDF if needed, and approves AI recommendations
4. The AM sends a **Calendly booking link** to the customer via email
5. **bookingWatcher** polls the AM's Microsoft Calendar every 2 minutes, detects when the customer books a Teams slot
6. The meeting **auto-conducts** 15 minutes after the scheduled end time
7. **transcriptFetch** polls Microsoft Graph for the Teams transcript (up to 2 hours), saves it, and emails the AM
8. The AM closes the meeting — the next month's meeting is auto-scheduled
9. Between meetings: carry-forward detection, auto-escalation at CF×3, weekly progress reports

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React, Vite, Tailwind CSS, React Query, Axios, Recharts, Lucide | React 19, Vite 6 |
| Backend | Node.js, Express, CommonJS | Node 18+, Express 4.19 |
| Database | PostgreSQL | 14+ (30 migrations) |
| Cache / Queue | Redis + BullMQ | Redis 7, BullMQ 5.8 |
| AI Engine | Ollama (local LLM — llama3.1 dev / llama3.3:70b prod) | Latest |
| Auth | JWT access + refresh tokens, bcryptjs | jsonwebtoken 9, bcryptjs 2.4 |
| Microsoft 365 | Azure AD OAuth2, Microsoft Graph API | — |
| Email | Nodemailer + Microsoft 365 SMTP | Nodemailer 9 |
| PDF | pdfkit (pre-meeting brief export) | 0.19 |
| File parsing | mammoth (DOCX), pdf-parse (PDF) | — |
| Security | Helmet, CORS allowlist, express-rate-limit, AES-256-GCM | — |
| Logging | Winston + Morgan | Winston 3.13 |
| API Docs | Swagger UI (OpenAPI 3) | swagger-ui-express 5 |

---

## Project Structure

```
BMMJ/
├── backend/
│   ├── src/
│   │   ├── app.js                      # Express app: middleware stack, route mounting
│   │   ├── server.js                   # HTTP server, job startup, graceful shutdown
│   │   ├── config/
│   │   │   ├── db.js                   # PostgreSQL pool
│   │   │   ├── bullmq.js               # Redis connection for BullMQ
│   │   │   ├── rate-limits.js          # generalLimiter + authLimiter
│   │   │   ├── swagger.js              # OpenAPI spec
│   │   │   └── validate.js             # Startup env validation (throws in prod)
│   │   ├── database/
│   │   │   ├── migrate.js              # Sequential migration runner
│   │   │   ├── seed.js                 # Demo data (2 tenants, 3 meetings)
│   │   │   └── migrations/             # 001_tenants.sql … 044_task_due_reminder_flags.sql
│   │   ├── integrations/
│   │   │   └── nxg360/                 # NXG360 API client + validation service
│   │   ├── jobs/
│   │   │   ├── t48.job.js              # T-48 workflow trigger
│   │   │   ├── reminder-windows.job.js # 7d/3d/1d reminder dispatch
│   │   │   ├── overdue.job.js          # Daily overdue task scan
│   │   │   ├── recurrence.job.js       # Auto-schedule next meeting on close
│   │   │   ├── weekly-report.job.js    # Monday 8 AM weekly report
│   │   │   ├── nxg360Sync.job.js       # 6-hour NXG360 findings sync
│   │   │   ├── email.job.js            # SMTP send queue with retry
│   │   │   ├── bookingWatcher.job.js   # Calendly booking detection via MS Calendar
│   │   │   ├── transcriptFetch.job.js  # Teams transcript import via Microsoft Graph API
│   │   │   ├── firefliesFetch.job.js   # Fireflies transcript polling (15-min intervals, 2-hr window)
│   │   │   └── taskDueReminder.job.js  # T-2d / T-1d due date reminder emails
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js       # JWT validation + role checks
│   │   │   ├── tenant.middleware.js
│   │   │   ├── errorHandler.js          # Removes stack traces in production
│   │   │   ├── correlation-id.middleware.js
│   │   │   └── timeout.middleware.js    # 30-second hard request timeout
│   │   ├── repositories/               # Data access layer — all parameterized queries
│   │   ├── routes/                     # 23 route files (one per domain)
│   │   ├── services/
│   │   │   ├── preMeeting.service.js        # Brief fetch + PDF export (pdfkit)
│   │   │   ├── email.service.js             # HTML template rendering + SMTP delivery
│   │   │   ├── actionPointsEmail.service.js # Post-meeting action items email to AM
│   │   │   ├── meetingNotes.service.js      # Notes upload/extraction pipeline
│   │   │   ├── fireflies.service.js         # Fireflies API — transcript fetch + sync
│   │   │   ├── invitation.service.js        # Meeting invitation dispatch
│   │   │   ├── notification.service.js      # In-app notification creation
│   │   │   ├── reminder.service.js          # Email reminder scheduling
│   │   │   ├── report.service.js            # Weekly/monthly report generation
│   │   │   ├── calendarProvider.service.js
│   │   │   ├── provider.service.js          # Meeting notes provider connections
│   │   │   ├── ai/
│   │   │   │   ├── AIRecommendationService.js  # Pre-meeting AI orchestration
│   │   │   │   ├── AIProvider.js               # Provider abstraction (Ollama)
│   │   │   │   ├── OllamaProvider.js            # Ollama HTTP client + retry logic
│   │   │   │   ├── FindingsProvider.js          # NXG360 findings cache layer
│   │   │   │   ├── PromptBuilder.js             # All LLM prompt construction
│   │   │   │   ├── RecommendationGenerator.js   # Single/batch task generation
│   │   │   │   └── RecommendationValidator.js   # Post-generation quality gates
│   │   │   ├── microsoft/
│   │   │   │   ├── MicrosoftOAuthClient.js      # OAuth2 code exchange + HMAC state
│   │   │   │   ├── MicrosoftTokenStore.js       # AES-256-GCM token encryption
│   │   │   │   └── MicrosoftCalendarClient.js   # Graph API: calendar + transcripts
│   │   │   └── notes/
│   │   │       ├── noteExtractor.service.js     # Segment extraction from raw transcript
│   │   │       ├── notePreprocessor.service.js  # Transcript cleaning + language detection
│   │   │       ├── noteStructurer.service.js    # Multi-mode structuring: D (segmented), E (single-pass), F (hierarchical)
│   │   │       └── postMeetingAnalysis.service.js # Post-meeting task generation + dedup
│   │   ├── templates/
│   │   │   └── emails/                 # 13 HTML email templates
│   │   └── utils/
│   │       └── logger.js               # Winston structured logger
│   ├── uploads/                        # Meeting document storage (local dev)
│   ├── .env                            # Local environment (not committed)
│   ├── .env.example                    # Full template with all required variables
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Dashboard.jsx
    │   │   ├── MeetingSchedule.jsx           # Main meeting management + brief + booking
    │   │   ├── Customers.jsx
    │   │   ├── Integrations.jsx              # Microsoft 365 + Fireflies + provider connections
    │   │   ├── Logs.jsx
    │   │   ├── tracker/
    │   │   │   ├── TrackerDashboard.jsx      # AI Generated Tasks + pending approvals
    │   │   │   ├── TrackerTaskList.jsx       # All tasks with filters
    │   │   │   ├── TrackerTaskDetail.jsx     # Single task detail + history
    │   │   │   ├── TrackerTimeline.jsx       # Task timeline view
    │   │   │   └── TrackerOwnership.jsx      # Ownership breakdown
    │   │   ├── reports/
    │   │   │   ├── ReportsDashboard.jsx
    │   │   │   ├── ReportList.jsx
    │   │   │   ├── ReportDetails.jsx
    │   │   │   └── ReportPreview.jsx
    │   │   └── monitoring/
    │   │       └── MonitoringDashboard.jsx   # Security health + NXG360 overview
    │   ├── components/
    │   │   ├── MicrosoftConnectButton.jsx    # OAuth connect + status display
    │   │   ├── AiTaskRecommendationsPanel.jsx # AI task cards — approve/reject/edit
    │   │   ├── MeetingList.jsx
    │   │   ├── MeetingNotesPanel.jsx
    │   │   ├── ApprovalWorkflowModal.jsx
    │   │   ├── ActionItemsPanel.jsx
    │   │   └── ...
    │   ├── services/
    │   │   └── api.js                        # Axios client + all API method wrappers
    │   └── context/
    │       └── TenantContext.jsx
    └── package.json
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | LTS recommended |
| PostgreSQL | 14+ | Create DB and user manually (see below) |
| Redis | 7+ | Windows: use [Memurai](https://www.memurai.com/) |
| Ollama | Latest | [ollama.com](https://ollama.com) — pull `llama3.1` |

---

## Local Development Setup

### 1. PostgreSQL — create database and user

```sql
-- Run as postgres superuser (psql -U postgres)
CREATE USER bmmj_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE "BMMJ" OWNER bmmj_user;
GRANT ALL PRIVILEGES ON DATABASE "BMMJ" TO bmmj_user;
```

### 2. Ollama — install and pull model

```bash
# After installing Ollama from https://ollama.com
ollama pull llama3.1

# Verify it's running
curl http://localhost:11434/api/tags
```

### 3. Clone and install dependencies

```bash
git clone <repo-url>
cd BMMJ

cd backend && npm install
cd ../frontend && npm install
```

### 4. Configure environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your values (see Environment Variables section below)
```

### 5. Run migrations and seed demo data

```bash
cd backend

# Run all 44 database migrations
npm run migrate

# Seed demo data (2 tenants, 3 meetings, full lifecycle trail)
npm run seed
```

### 6. Start the servers

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| API Docs (Swagger) | http://localhost:5000/api/docs |
| Health Check | http://localhost:5000/health |

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env`. All variables below are required for full functionality.

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Backend listen port |
| `NODE_ENV` | `development` | Set to `production` to enforce strict validation |
| `CLIENT_URL` | `http://localhost:5173` | Frontend origin — CORS allowlist. Comma-separated for multiple (e.g. `http://localhost:5173,https://your-tunnel.devtunnels.ms`). **Password reset email picks the first non-localhost URL** so reset links work when the AM opens them from a different device. Put your public/tunnel URL here. |

### Database

| Variable | Description |
|---|---|
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (default: 5432) |
| `DB_USER` | PostgreSQL user |
| `DB_PASSWORD` | PostgreSQL password |
| `DB_NAME` | Database name (`BMMJ`) |

### JWT (use long random strings — minimum 48 chars each, all different)

```bash
# Generate a secret
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Variable | Description |
|---|---|
| `JWT_SECRET` | Legacy fallback (keep set) |
| `JWT_ACCESS_SECRET` | Access token signing key |
| `JWT_REFRESH_SECRET` | Refresh token signing key (must differ from access) |

### Redis

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

### Encryption Keys (must be exactly 64 hex characters = 32 bytes)

```bash
# Generate an encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Description |
|---|---|
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for encrypting Microsoft OAuth tokens at rest |
| `NXG360_ENCRYPTION_KEY` | AES-256-GCM key for encrypting NXG360 API credentials |

### Microsoft 365 / Azure AD (required for booking detection, transcript import, and system email)

Register an app at [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations.

Required API permissions (Microsoft Graph):
- **Delegated** (for the AM's own calendar/Teams connection): `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `OnlineMeetingTranscript.Read.All`, `offline_access`, `User.Read`
- **Application** (for the app-only system email sender — see `MicrosoftAppAuthClient.js`): `Mail.Send`

Grant admin consent for both sets on the API permissions page.

| Variable | Description |
|---|---|
| `MS_CLIENT_ID` | Azure AD application (client) ID |
| `MS_CLIENT_SECRET` | Client secret from Azure portal |
| `MS_REDIRECT_URI` | `http://localhost:5000/api/integrations/microsoft/callback` (dev) |
| `MS_TENANT_ID` | Azure AD Directory (tenant) ID — required; without it, both the OAuth flow and the app-only email sender fall back to the multi-tenant `/organizations` endpoint |
| `MS_MAIL_SENDER` | Optional — mailbox the system sends email as via Graph. Defaults to `SMTP_USER` if unset |

### NXG360

| Variable | Description |
|---|---|
| `NXG360_API_BASE_URL` | `https://nxg360.nxgsecure.com/api` |

### Email (Microsoft 365 SMTP)

| Variable | Description | Example |
|---|---|---|
| `SMTP_HOST` | SMTP server | `smtp.office365.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | TLS mode (`false` = STARTTLS) | `false` |
| `SMTP_USER` | SMTP login | `name@nxgsecure.com` |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | From header | `BMMJ Platform <name@nxgsecure.com>` |

### Ollama AI Engine

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.1` | Primary model (8B — CPU-safe, runs locally) |
| `OLLAMA_TIMEOUT` | `600000` | Socket timeout in ms. **Important:** Ollama's server drops connections at ~5 min regardless of this setting. The pipeline is tuned around this — `maxTokens=300` per segment keeps each generation under 1.5 min. Don't raise `maxTokens` without testing on your hardware first. |
| `OLLAMA_NUM_CTX` | `4096` | Context window (tokens). Mode D uses 4096; Mode E (English single-pass) uses 16384. |
| `AI_CONCURRENCY` | `2` | Max simultaneous AI analyses |
| `AI_MAX_ITEMS_PER_RUN` | `20` | Max items processed per AI run |

---

## Demo Credentials

Run `npm run seed` inside `backend/` first.

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@bmmj.com` | `Seed@Demo2026` |
| Account Manager (Acme) | `sarah.johnson@bmmj.com` | `Seed@Demo2026` |
| Account Manager (TechNova) | `michael.chen@bmmj.com` | `Seed@Demo2026` |

### Demo Data Overview

**Acme Financial Services** (America/New_York)
- May-12 meeting: `CLOSED` — full lifecycle trail: 4 findings, 3 tasks (1 completed, 2 carry-forward), AI recs, notes, monthly report
- Jun-12 meeting: `CONDUCTED` — 4 active tasks (CF×2 + CF×3), awaiting closure
- Microsoft 365 connected (demo placeholder tokens — reconnect via Integrations page for live use)

**TechNova Solutions** (America/Chicago)
- Jul-01 meeting: `SCHEDULED` — first-ever meeting, T-48 fires Jun-29
- Microsoft 365 connected (demo placeholder tokens)

> Seed placeholder OAuth tokens allow both tenants to show "Connected to Microsoft" in the UI. They will fail gracefully on any real Microsoft API call. Connect live via the Integrations page to replace them.

---

## API Reference

Interactive Swagger UI: **http://localhost:5000/api/docs**

Raw OpenAPI JSON: `GET /api/docs.json`

| Route prefix | Description |
|---|---|
| `POST /api/auth/*` | Login, refresh, logout, password reset |
| `/api/tenants/*` | Tenant CRUD (super_admin) |
| `/api/customers/*` | Customer management + AM assignment |
| `/api/meetings/*` | Meeting lifecycle, brief, PDF export, booking |
| `/api/tasks/*` | Task management |
| `/api/meeting-logs/*` | Meeting log entries + file upload/download |
| `/api/tracker/*` | Remediation tracker |
| `/api/providers/*` | Notes provider connections + sync |
| `/api/calendar/*` | Calendar connections + config + sync logs |
| `/api/integrations/microsoft/*` | Microsoft 365 OAuth2 flow |
| `/api/nxg360/*` | Live NXG360 findings + sync status |
| `/api/ai/*` | AI recommendation engine — update, approve, reject, reanalyze |
| `/api/action-items/*` | Post-meeting action items (email dispatch + confirmation tokens) |
| `/api/fireflies/*` | Fireflies integration — connect, sync transcript, webhook |
| `/api/reports/*` | Weekly + monthly reports |
| `/api/notifications/*` | In-app notifications |
| `/api/audit-logs/*` | Audit trail |
| `/api/analytics/*` | Dashboard analytics data |
| `/api/monitoring/*` | Security health + NXG360 monitoring overview |
| `/api/findings/*` | Per-meeting NXG360 findings |
| `GET /health` | Health check with live DB probe (no auth) |
| `GET /api/docs` | Swagger UI (no auth) |

---

## Background Jobs

All jobs start automatically with the server and stop gracefully on SIGTERM/SIGINT.

| Job | Schedule | Purpose |
|---|---|---|
| `t48.job.js` | Polls every 5 min | Fires T-48 workflow: pulls NXG360 findings + triggers AI analysis |
| `reminder-windows.job.js` | Polls every 2 min | Dispatches email reminders at 7d / 3d / 1d before meeting |
| `overdue.job.js` | Daily | Scans for overdue tasks, updates statuses |
| `recurrence.job.js` | On meeting close | Auto-creates next month's meeting |
| `weekly-report.job.js` | Monday 8 AM | Generates weekly progress report per tenant |
| `nxg360Sync.job.js` | Every 6 hours | Syncs live security findings from NXG360 API |
| `email.job.js` | On demand (queue) | Processes SMTP send queue with retry |
| `bookingWatcher.job.js` | Polls every 2 min | Detects Calendly bookings in AM's Microsoft Calendar |
| `transcriptFetch.job.js` | Polls every 5 min | Fetches Teams transcript via Microsoft Graph (2-hour window) — used when Fireflies is not connected |
| `firefliesFetch.job.js` | Polls every 15 min | Fetches Fireflies AI transcript after meeting is conducted (FIRST_DELAY=15 min, MAX_DURATION=2 hrs). Triggers AI notes pipeline on receipt. Recovery scan on startup re-queues stuck meetings. |
| `taskDueReminder.job.js` | Daily | Sends T-2d / T-1d due date reminder emails for approved tasks |

On restart, `bookingWatcher` automatically re-queues any meetings still in `booking_pending` state. `firefliesFetch` re-queues any meetings with `transcript_status = 'fetching'` that haven't completed yet.

---

## Email Templates

Located in `backend/src/templates/emails/`. Rendered with `{{variable}}` (HTML-escaped) and `{{{variable}}}` (raw HTML, used for dynamic content like buttons).

| Template | When it fires |
|---|---|
| `meeting-invitation.html` | Meeting created / invitations sent to attendees |
| `meeting-reminder.html` | 7 days / 3 days / 1 day before meeting |
| `booking-link.html` | AM clicks "Send Booking Link" — Calendly URL sent to customer |
| `booking-expired.html` | Customer didn't book within 7 days |
| `post-meeting-summary.html` | After meeting conducts — transcript ready or unavailable |
| `action-points-email.html` | Post-meeting action items email to AM with approve/reject links |
| `am-task-confirmed.html` | Confirmation to AM when customer confirms a task via email |
| `carry-forward.html` | Task carries forward (CF×2 warning / CF×3 alert) |
| `escalation.html` | Task auto-escalated to super_admin at CF×3 |
| `weekly-report.html` | Monday weekly progress summary sent to AM |
| `task-due-reminder.html` | T-2d / T-1d before task due date — reminder to AM |
| `password-reset.html` | Forgot password flow |
| `notification-retry.html` | Failed notification retry attempt |

---

## Microsoft 365 Integration

### Automated Booking + Conduct Flow

```
1. AM clicks "Send Booking Link"
      → booking-link.html email sent to customer with Calendly URL
      → bookingWatcher job queued immediately

2. bookingWatcher polls AM's Microsoft Calendar every 2 minutes
      → Looks for events created after booking link was sent
      → Match criteria: Teams join URL present + customer email as attendee
                        + duration within ±10 minutes of expected
      → On match: DB confirmBooking(), schedules auto-conduct at scheduledEnd + 15 min

3. auto-conduct fires at scheduledEnd + 15 min
      → scheduled → approval_pending → conducted (in one transition)
      → transcriptFetch.schedule() called

4. transcriptFetch polls Microsoft Graph every 5 min for up to 2 hours
      → Resolves Teams meeting ID from join URL
      → Polls /onlineMeetings/{id}/transcripts
      → Downloads VTT transcript text
      → Saves to meetings.transcript_text (transcript_status = 'captured')
      → Sends post-meeting-summary.html to AM

5. If no transcript after 2 hours → transcript_status = 'unavailable'
      → Still sends post-meeting-summary.html (no transcript variant)

6. If booking not made within 7 days → booking-expired.html sent to customer
```

### OAuth2 Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/integrations/microsoft/authorize` | JWT | Initiates OAuth2 flow, returns redirect URL with HMAC-signed state |
| `GET /api/integrations/microsoft/callback` | Public | Microsoft redirects here; exchanges code for tokens, stores encrypted |
| `POST /api/integrations/microsoft/verify` | JWT | Validates stored token against Graph API |
| `GET /api/integrations/microsoft/status` | JWT | Returns connection status + Calendly URL |
| `POST /api/integrations/microsoft/save-calendly-url` | JWT | Stores AM's Calendly booking URL |
| `POST /api/integrations/microsoft/disconnect` | JWT | Revokes and removes tokens |

### Token Security

- Access and refresh tokens encrypted with **AES-256-GCM** before PostgreSQL storage
- `TOKEN_ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes)
- Tokens **auto-refresh** transparently when within 5 minutes of expiry on every `MicrosoftTokenStore.load()` call
- On auth failure during background jobs: connection marked `expired`, job stops gracefully, connection status updated in DB

---

## Fireflies Integration

Fireflies AI records the Teams/video call, generates a transcript, and the app fetches it automatically after the meeting is conducted. This is the **primary transcript source** for most tenants.

### How the Fireflies flow works

```
AM marks meeting as Conducted
    → firefliesFetch BullMQ job queued (FIRST_DELAY = 15 min)
    → Polls Fireflies GraphQL API every 15 min (MAX_DURATION = 2 hrs)
    → Transcript found → saved to DB (transcript_status = 'captured')
    → MeetingNotesService.processNotes() triggered automatically
    → AI pipeline runs → MOM + action items appear in Meeting Logs
```

### Connecting Fireflies per tenant

Each tenant stores its own Fireflies API key. Connect from the **Integrations page** while the correct tenant is active in the tenant selector:

1. Go to Integrations → Fireflies section
2. Enter the API key from your Fireflies account
3. Click **Connect** — app calls Fireflies API to verify the key and upserts the connection for this tenant's `tenant_id`
4. Status changes to **Connected** with the last-used timestamp

> **Important:** The Fireflies connection is keyed by `tenant_id`. If you see "Connected" in the UI but transcripts aren't being fetched, disconnect and reconnect while the correct tenant is active in the dropdown. This re-saves the API key under the right tenant_id.

### Fireflies API endpoints used

| Operation | Method | Description |
|---|---|---|
| Verify API key | `POST /api/fireflies/connect` | Validates key + upserts connection for active tenant |
| Disconnect | `POST /api/fireflies/disconnect` | Removes connection for active tenant |
| Fetch transcript | Internal (job) | GraphQL `transcript(id)` query — fetches full text + speaker list |
| Match transcript to meeting | Internal (job) | Title fuzzy-match against meeting title in DB |

### Fireflies environment

Fireflies needs no environment variables. The API key is stored per-tenant in the `fireflies_connections` table (encrypted at rest). The app uses the per-tenant key for all API calls.

### Recovery

On backend restart, `firefliesFetch` runs a recovery scan and automatically re-queues any meeting with `transcript_status = 'fetching'` that didn't finish. No manual action needed.

---

## AI Notes Pipeline — How It Works

After a transcript is fetched (from Fireflies or Teams), `MeetingNotesService` runs `noteStructurer.service.js` to extract MOM (Meeting Summary, Action Items, Decisions, Risks, Follow-ups) using the local Ollama model.

### Language Detection

`notePreprocessor` checks the ratio of non-ASCII characters. If **more than 40%** are non-ASCII (Devanagari / Hindi script), the transcript is flagged `highNonAscii = true`. This controls:

- Which AI mode is selected (Mode D instead of Mode E for Hindi)
- Segment size (2000 chars for Hindi vs 7000 for English)
- Vocabulary checks (relaxed for Devanagari — model outputs English from Hindi speech)
- Prompt additions (Hindi verb patterns: करेंगे, बताएंगे, देखेंगे used as action indicators)

### Extraction Modes

| Mode | When used | How it works | Key params |
|---|---|---|---|
| **Mode E** — Single Pass | English, ≤ 30K chars | Sends full transcript in one call (numCtx=16384). Best consistency. **Skipped for Hindi** — the 16K context + 4000-token output exceeds the 5-min Ollama connection limit on CPU-only inference. | maxTokens: 4000 |
| **Mode D** — Segmented | Hindi/Hinglish (all sizes) + English fallback | Splits transcript into overlapping chunks. Each chunk is independently extracted, then items are merged and deduplicated. MAX_SEGMENTS = 8. | segSize: 2000 (Hindi) / 7000 (English), maxTokens: 300, numCtx: 4096 |
| **Mode F** — Hierarchical | English, > 30K chars | Two-pass: first summarises each large segment into bullets, then extracts from the combined summary. | segSize: 8000, two Ollama calls per segment |
| **Mode B** — Fallback | All modes fail | Section-based fallback. Produces minimal output. Logged as warning. | — |

### Scope Anchoring

Before extraction, `buildMeetingContext` takes a 3000-char sample (start + middle + end of transcript) and asks Ollama to identify the meeting's primary topic and scope keywords. These keywords are then injected into every segment prompt so the model stays on-topic and doesn't invent items from a different meeting.

### Quality Filters

Every extracted item passes two checks:
1. **Vocabulary check (`passesTranscriptCheck`)** — item must contain words found in the transcript. Relaxed for high-Devanagari text.
2. **Scope filter (`filterByMeetingContext`)** — item must overlap with the scope keywords from `buildMeetingContext`. Prevents off-topic hallucinations.

### Participant Identification

Internal participants are identified by **email domain only**: `@nxgsecure.com = internal`. No hardcoded names anywhere in the codebase. Fireflies provides participant emails which are enriched with the `is_internal` flag at fetch time.

### Post-meeting Task Generation

After MOM is saved, `postMeetingAnalysis.service.js` combines the meeting notes with live NXG360 security findings to generate specific `ai_task_recommendations`. These appear in Meeting Logs for AM to review, approve, reject, or edit. Only `pending` recommendations are replaced on a re-run — `approved` and `rejected` records are preserved.

---

## Feature Phases — Implementation Status

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Database foundation — 44 sequential migrations, multi-tenant schema | ✅ Complete |
| Phase 2 | JWT auth, refresh token rotation, RBAC, role-based route guards | ✅ Complete |
| Phase 3 | Tenant/customer management, multi-AM assignment, primary AM tracking | ✅ Complete |
| Phase 4 | AI recommendation engine — Ollama local only (llama3.1 dev / llama3.3:70b prod), pre-meeting + post-meeting pipelines | ✅ Complete |
| Phase 5 | Full meeting lifecycle state machine + reschedule approval cycles | ✅ Complete |
| Phase 6 | Remediation tracker — carry-forward, escalation, review outcomes | ✅ Complete |
| Phase 6.5 | Meeting notes provider framework — connections, sync logs, mapping | ✅ Complete |
| Phase 7 | Calendar integration — T-48 job, reminder-windows job, task due reminders | ✅ Complete |
| Phase 8 | Pre-meeting brief — NXG360 findings + AI recs + PDF export | ✅ Complete |
| Phase 9 | Email notifications — 13 templates, SMTP queue, invitations, reminders, reports | ✅ Complete |
| Phase 10 | Live NXG360 sync — 6-hour background job, Redis findings cache | ✅ Complete |
| Phase 11 | Microsoft 365 + Calendly — OAuth2, booking detection, auto-conduct, Teams transcripts | ✅ Complete |
| Phase 12 | Post-meeting AI pipeline — Mode D/E/F segmentation, Hindi/Hinglish detection, scope anchoring, vocab quality filters, task dedup | ✅ Complete |
| Phase 13 | Production hardening — rate limiting, Helmet, CORS, HTTPS, graceful shutdown, audit logs | ✅ Complete |
| Fireflies | Per-tenant Fireflies API integration — transcript sync, webhook, automatic post-meeting trigger | ✅ Complete |
| Pending | Per-route stricter rate limits (auth: 5 req/min); NxgSecure UI rebrand (19 files — paused) | Planned |

---

## Security Checklist

| Control | Details |
|---|---|
| Rate limiting | Global: 200 req/15 min (prod). Auth routes: 10 req/15 min (prod) |
| Secure headers | `helmet()` — HSTS, CSP, X-Frame-Options, X-Content-Type-Options |
| CORS | Strict allowlist from `CLIENT_URL` — no wildcard, credentials-safe |
| SQL injection | All 200+ queries use parameterized `$1/$2` placeholders via pg driver |
| Password storage | bcryptjs — configurable rounds, no plain-text ever stored |
| JWT security | Token type validation — prevents refresh-as-access substitution |
| Refresh tokens | Stored as SHA-256 hash in DB; raw token never persisted |
| OAuth state | HMAC-SHA256 signed state parameter; timing-safe comparison on callback |
| Token encryption | AES-256-GCM for all Microsoft OAuth tokens at rest |
| Error responses | Stack traces removed from all production responses |
| Body limits | 1 MB JSON + URL-encoded hard limit |
| Request timeout | 30-second hard timeout — returns 503 on hung requests |
| Compression | Gzip via `compression()` middleware |
| HTTPS redirect | `x-forwarded-proto` check in production — 301 redirect |
| Graceful shutdown | SIGTERM/SIGINT drain DB pool and stop all BullMQ workers |
| Env validation | `validateConfig()` throws at startup if required vars are missing or default in production |
| Health check | `GET /health` — live DB latency probe for load balancers |
| Correlation IDs | `X-Request-ID` on every request and response for distributed tracing |

---

## npm Scripts

```bash
# Backend
npm run dev          # Start with nodemon (auto-reload on change)
npm start            # Production start (no nodemon)
npm run lint         # ESLint across src/
npm run migrate      # Run pending database migrations (001–044)
npm run seed         # Load demo data (safe to re-run — deletes and recreates)

# Frontend
npm run dev          # Vite dev server with HMR
npm run build        # Production build to dist/
npm run lint         # ESLint
npm run preview      # Preview production build locally
```

---

## Health Check

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "commit": "local",
  "uptime": 42,
  "timestamp": "2026-06-26T10:00:00.000Z",
  "database": { "connected": true, "latencyMs": 2 }
}
```

Returns `503` with `"status": "degraded"` if the database is unreachable.

---

## Scalability Notes

The current architecture handles the intended scale (10–100 customer tenants, 5–20 AMs) with significant headroom. The following are the only items worth revisiting as the platform grows:

| Concern | Current state | When to fix |
|---|---|---|
| **Ollama server** | Runs on same machine as Express | Move to dedicated server by updating `OLLAMA_BASE_URL` — no code change |
| **File uploads** | Local `backend/uploads/` directory | Replace with S3/Azure Blob when running multiple server instances |
| **Worker isolation** | BullMQ workers run in the same process as Express | Extract to a separate `worker.js` entry point for high-load deployments (jobs already export `{ start, stop }`) |
| **Redis HA** | Single Redis instance | Add Redis Sentinel or Cluster for zero-downtime rolling deploys |
| **Migration concurrency** | Runs at startup, no lock | Add a PostgreSQL advisory lock in `migrate.js` for simultaneous multi-instance starts |

---
<!-- https://claude.ai/code/artifact/ec6bb5c0-75e0-4dff-bd4e-060c93951ae8?via=auto_preview -->

*BMMJ Platform v1.0.0 — NXG Secure*
