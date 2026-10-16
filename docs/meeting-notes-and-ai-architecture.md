# Meeting Notes Integration Architecture

## Recommended Flow

`Meeting Platform -> Meeting Notes Provider -> Meeting Notes Integration Service -> Meeting Transcript Repository -> AI Summary Service -> Meeting Logs -> Task Generation -> Weekly Reports`

## Core Design

- Use a provider adapter layer per vendor.
- Normalize all incoming payloads into one internal schema.
- Persist raw transcript payloads separately from derived intelligence.
- Make tenant resolution explicit on every webhook and API read.
- Treat ingestion as idempotent and event-driven.
- Use async processing for transcription, summarization, extraction, and report generation.

## Vendor Evaluation

### Microsoft Teams Meeting Notes

- Integration method: Microsoft Graph transcripts + recording resources, plus change notifications.
- API availability: Yes, Graph transcript and meeting insights APIs.
- OAuth support: Yes, via Microsoft Entra ID / Microsoft 365 Copilot permissions.
- Webhook support: Yes, Graph change notifications.
- Data model: transcript, recording, meeting insights, action items, mentions.
- Security considerations: use tenant-scoped Graph permissions, RSC where possible, and strict transcript access controls.

### Microsoft Copilot Meeting Notes

- Integration method: Microsoft 365 Copilot APIs and Meeting AI Insights API.
- API availability: Yes, meeting insights and AI insights change notifications.
- OAuth support: Yes, Microsoft 365 Copilot licensed user context.
- Webhook support: Yes, AI Insights change notifications.
- Data model: summary, action items, mentions, transcript-backed insights.
- Security considerations: enforce Copilot licensing, tenant boundaries, and Graph permission scopes.

### Zoom AI Companion Notes

- Integration method: Zoom meeting summary / transcript APIs, webhook events, and Zoom AI services.
- API availability: Yes, Zoom Meeting API, webhooks, and AI Services summarizer.
- OAuth support: Yes, for public apps and marketplace apps.
- Webhook support: Yes, meeting and AI Companion related webhooks.
- Data model: meeting summary, transcript, action items, recording metadata.
- Security considerations: validate Zoom webhook signatures, enforce tenant-to-account mapping, and store tokens encrypted.

### Google Meet Notes

- Integration method: Google Meet REST API artifacts and smart notes / transcript access.
- API availability: Yes, Meet REST artifacts and transcript endpoints.
- OAuth support: Yes, Google Workspace OAuth.
- Webhook support: Limited / event-driven patterns should rely on Google Workspace change or polling where needed.
- Data model: transcript, smart notes, recording, conference record metadata.
- Security considerations: use domain-wide delegation or user consent only where permitted; enforce Workspace-level access.

### Otter.ai

- Integration method: Public API and workspace webhooks.
- API availability: Yes, enterprise public API.
- OAuth support: API key / bearer token model; no OAuth requirement in current docs.
- Webhook support: Yes, workspace webhooks.
- Data model: channels, conversations, transcripts, audio, action items, insights, outlines.
- Security considerations: protect API keys, verify webhook signatures, and scope access to workspace-owned conversations.

### Fireflies.ai

- Integration method: GraphQL API plus webhooks and realtime WebSocket ingestion.
- API availability: Yes, public GraphQL API.
- OAuth support: API key / bearer token model.
- Webhook support: Yes, transcription completion webhooks.
- Data model: transcript, participants, summary, action items, speaker segments.
- Security considerations: verify webhook signatures, restrict organizer scope, and store API tokens securely.

### Fathom

- Integration method: REST API, webhooks, and OAuth app model for public integrations.
- API availability: Yes, public API.
- OAuth support: Yes, public OAuth apps for installable integrations.
- Webhook support: Yes.
- Data model: meetings, summaries, transcripts, action items, teams.
- Security considerations: user-level API keys are scoped to the user or shared team data; verify webhook signatures and respect team sharing rules.

### Avoma

- Integration method: REST API, webhooks, and scoped API keys.
- API availability: Yes, API documentation and scoped API keys.
- OAuth support: Not the primary documented model; use scoped API keys.
- Webhook support: Yes, organization webhooks.
- Data model: notes, recordings, transcripts, summaries, tasks, coaching insights.
- Security considerations: use signing secrets, custom headers, team-scoped webhook events, and least-privilege API scopes.

### Grain

- Integration method: OAuth2 API, hooks, and public API endpoints.
- API availability: Yes, public API.
- OAuth support: Yes, OAuth2 flow is documented.
- Webhook support: Yes, hooks/webhooks.
- Data model: recordings, transcripts, highlights, meeting types, users, teams, AI template sections.
- Security considerations: use scoped tokens, include version headers, and store refresh tokens securely.

### Sembly

- Integration method: API key auth, webhooks, and MCP integration.
- API availability: Yes, public API guidance is available.
- OAuth support: Not the primary documented model; use API keys.
- Webhook support: Yes, workspace automations and webhooks.
- Data model: notes, transcripts, tasks, meeting history, attachments, structured summaries.
- Security considerations: use workspace-level access, secure API keys, and keep webhook exports tenant-aware.

## Short-Term MVP Strategy

- Start with Microsoft Teams, Zoom, and Google Meet because they cover the largest enterprise meeting footprint.
- Add one third-party notetaker integration first, preferably Otter or Fireflies, to validate webhook ingestion and transcript normalization.
- Store all provider payloads in one raw transcript repository and map them into the same meeting-log schema.
- Keep AI summarization in a single internal service rather than duplicating provider-specific summaries.

## Medium-Term Strategy

- Add provider-specific connector workers for each vendor.
- Use one queue per provider plus a shared normalization queue.
- Add retry, backoff, idempotency keys, and dead-letter handling.
- Introduce human review for summary and task extraction on high-risk tenants.

## Enterprise Strategy

- Support account-level and user-level connector credentials.
- Add field-level redaction for PII and sensitive meeting content.
- Split ingestion, summarization, and report generation into separate workers.
- Add per-tenant encryption keys, audit logs, and retention policies.
- Route AI outputs through approval gates before they create tasks or close reports.

## AI Services

### Meeting Notes Summarizer

- Input: transcript text, provider metadata, participant list, meeting date.
- Output: summary, decisions, risks, meeting brief.
- Trigger: when transcript ingestion completes or when a transcript is updated.
- Storage model: `meeting_notes.summary`, `meeting_notes.meeting_summary`, `meeting_notes.ai_status`.

### Action Item Extractor

- Input: transcript text, summary, participant roles.
- Output: structured action items with owner, due date, severity, and confidence.
- Trigger: after summarization or when notes are ready.
- Storage model: `meeting_notes.action_items`, `tasks.timeline`, `tasks.notes`.

### Remediation Task Generator

- Input: findings, action items, tenant profile, ownership data.
- Output: remediation tasks with owners, teams, due dates, and progress defaults.
- Trigger: after meeting summary approval or on scheduled workflow.
- Storage model: `tasks`, `tasks.primary_owner`, `tasks.secondary_owner`, `tasks.timeline`.

### Meeting Brief Generator

- Input: upcoming meeting context, historical tasks, open risks, previous meeting notes.
- Output: pre-meeting brief for the account manager.
- Trigger: before scheduled meetings, typically 24 to 48 hours ahead.
- Storage model: recommend a future `meeting_briefs` table or derived cache.

### Weekly Report Generator

- Input: open tasks, closed tasks, escalations, meeting logs, summaries.
- Output: weekly and monthly reports, export payloads, and summary text.
- Trigger: scheduled weekly job and manual regeneration.
- Storage model: `reports.export_payload`, `reports.summary`, `reports.progress_percentage`.

## Storage Recommendation

- `meeting_notes` for the normalized meeting intelligence.
- `reports` for generated weekly and monthly outputs.
- `tasks` for remediation actions and ownership.
- Add a future `meeting_transcripts` table for raw transcript retention if transcript volume grows.
