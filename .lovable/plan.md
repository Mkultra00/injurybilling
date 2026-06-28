# Wellator Build Plan

TanStack Start + Lovable Cloud + Lovable AI. Ingestion hits the real (rate-limited) PCC mock API. ElevenLabs agent calls a public webhook with a defined JSON shape below.

## 1. Lovable Cloud schema (one migration)

**Raw layer** (idempotent upsert):
- `raw_patients` (patient_id pk, facility, payload jsonb, fetched_at)
- `raw_diagnoses` (id pk, patient_id, payload, fetched_at)
- `raw_coverage` (patient_id pk, payload, fetched_at)
- `raw_notes` (id pk, patient_id, format, body, payload, fetched_at)
- `raw_assessments` (id pk, patient_id, payload, fetched_at)
- `ingest_failures` (id, patient_id, endpoint, status, error, attempted_at)

**Extraction layer:**
- `wound_extractions` (id, source_table, source_id, patient_id, wound_type, wound_stage, location, length_cm, width_cm, depth_cm, drainage, is_primary_wound, confidence, extraction_notes, source_quote, raw_json, created_at)

**Decision layer:**
- `eligibility_output` (patient_id pk, facility, decision [auto_accept|flag_for_review|reject], routing_reason, primary_extraction_id, has_partb bool, missing_fields text[], updated_at)

**Ops:**
- `pipeline_runs` (id, started_at, finished_at, patients_processed, http_429s, extraction_failures, status)
- `user_roles` + `has_role()` (admin gating for "run pipeline")

All tables: RLS on. `GRANT SELECT` to `authenticated`, `GRANT ALL` to `service_role`, no anon. Same-migration GRANTs.

## 2. Server functions (`src/lib/*.functions.ts`, all `requireSupabaseAuth` + admin check)

- **`runIngestion({ facility })`** — fetches `/pcc/patients`, then per-patient `/pcc/diagnoses`, `/pcc/coverage`, `/pcc/notes`, `/pcc/assessments`. Retry wrapper: respects `Retry-After`, exponential backoff with jitter, max 5 attempts, concurrency cap ~6. Upserts raw rows immediately. Logs exhausted requests to `ingest_failures`. Updates `pipeline_runs`. One facility per call to stay inside Worker time limits — UI loops through 3.

- **`runExtraction()`** — pulls notes/assessments without an extraction row. Calls Lovable AI Gateway with `google/gemini-3-flash-preview` using AI SDK `generateText` + `Output.object` (Zod schema). Prompt requires `source_quote` (verbatim snippet) per wound for dashboard drill-down. On error/malformed JSON: one retry with stricter prompt, then writes low-confidence stub.

- **`runRulesEngine()`** — deterministic TS. Picks primary wound (highest stage → largest area). Decision:
  - `reject`: no Part B OR no classifiable wound
  - `flag_for_review`: missing measurement/drainage, OR Envive + non-high confidence, OR multi-wound ambiguity
  - `auto_accept`: all four conditions present + high confidence
  Writes `eligibility_output` with plain-English `routing_reason` and `missing_fields[]`.

- **`runPipeline()`** — orchestrates the above, returns run summary.

## 3. ElevenLabs webhook — shape

`POST /api/public/voice-agent` — single endpoint, HMAC-verified.

**Auth:** `x-webhook-signature: <hex hmac-sha256 of raw body using ELEVENLABS_WEBHOOK_SECRET>`. Timing-safe compare. 401 on mismatch.

**Request body (agent → us):**

```json
{
  "tool": "facility_summary" | "list_patients" | "patient_detail" | "explain_decision",
  "args": {
    "facility": "A" | "B" | "C" | null,
    "decision": "auto_accept" | "flag_for_review" | "reject" | null,
    "patient_id": "FA-014" | null,
    "limit": 10
  }
}
```

**Response shapes (speech-friendly, short, agent's LLM phrases the answer):**

`facility_summary`:
```json
{ "facility": "B", "auto_accept": 38, "flag_for_review": 17, "reject": 9, "top_flag_reason": "missing drainage documentation" }
```

`list_patients`:
```json
{ "count": 3, "patients": [
  { "patient_id": "FA-014", "facility": "A", "decision": "flag_for_review", "reason": "depth not documented" }
]}
```

`patient_detail`:
```json
{ "patient_id": "FA-014", "facility": "A", "decision": "flag_for_review",
  "wound_type": "pressure_ulcer", "stage": "3", "location": "sacrum",
  "measurements": { "length_cm": 4.2, "width_cm": 3.1, "depth_cm": null },
  "drainage": "moderate", "has_partb": true, "confidence": "high",
  "missing_fields": ["depth_cm"], "reason": "depth measurement missing" }
```

`explain_decision`:
```json
{ "patient_id": "FA-014", "decision": "flag_for_review",
  "reason": "Wound depth was not documented in the source note; all other fields present.",
  "source_quote": "Stage 3 sacral pressure ulcer, 4.2 x 3.1 cm, moderate drainage." }
```

**Refusals:** any tool name not in the enum, or any args asking to approve/reject/submit a claim → `{ "error": "informational_only", "message": "Routing decisions stay in the dashboard." }`.

Reads via publishable-key server client with narrow projection. No PII beyond patient_id. Returns 200 + JSON for everything legitimate.

## 4. Dashboard

- `/auth` — email/password + Google.
- `/_authenticated/dashboard` — stat bar (counts per decision, per facility), filter chips, table with color-coded badges, `routing_reason` column, expand row → source note + extracted JSON + highlighted `source_quote`, confidence pill.
- `/_authenticated/runs` — pipeline run history: throughput, 429 retries, extraction failures.
- Admin-only "Run pipeline" button → `runPipeline` server fn with toast progress.
- Data via TanStack Query: loader `ensureQueryData`, component `useSuspenseQuery`.

## 5. Secrets

- `PCC_API_BASE_URL`, `PCC_API_KEY` (if required) — ask user
- `ELEVENLABS_WEBHOOK_SECRET` — generate
- `LOVABLE_API_KEY` — auto-provisioned

## 6. Build order

1. Enable Lovable Cloud, run schema migration, seed admin role.
2. Auth scaffold (`_authenticated` layout managed by integration).
3. `runIngestion` + `/runs` page, validate against PCC + rate-limit.
4. `runExtraction` with Lovable AI structured output.
5. `runRulesEngine` + dashboard table + drill-down.
6. Public webhook endpoint with HMAC verification + JSON shapes.
7. Polish: facility filter, loading/empty/error states, run charts.

## Questions before I start

1. **PCC base URL** + auth header name/value (or none)? Need to set `PCC_API_BASE_URL` / `PCC_API_KEY`.
2. The webhook tool shape above — does your ElevenLabs agent already send a specific JSON, or should it be configured to match what's defined here?
