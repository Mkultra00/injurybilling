import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ExtractionSchema, EXTRACTION_SYSTEM_PROMPT } from "@/lib/wellator/extraction-schema";
import { decideEligibility, pickPrimary } from "@/lib/wellator/rules";
import type { ExtractionRow } from "@/lib/wellator/types";

// PCC hackathon facilities. Labels are how clinicians know them; IDs are PCC's.
export const FACILITIES = [
  { id: 101, label: "Facility A" },
  { id: 102, label: "Facility B" },
  { id: 103, label: "Facility C" },
] as const;
const FACILITY_IDS = FACILITIES.map((f) => f.id) as unknown as [number, ...number[]];
const PCC_BASE_DEFAULT = "https://hackathon.prod.pulsefoundry.ai";

// ---------- helpers ----------

async function ensureAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  counters: { http_429s: number },
  maxAttempts = 20,
): Promise<Response> {
  let lastErr: unknown;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, init);
      lastStatus = resp.status;
      if (resp.status === 429) {
        counters.http_429s += 1;
        const retryAfter = Number(resp.headers.get("Retry-After"));
        // Honor Retry-After but cap at 30s so a single worker invocation
        // doesn't exceed runtime limits; remaining work falls to backfill.
        const base = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30000)
          : Math.min(2 ** attempt * 400, 15000);
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, base + jitter));
        continue;
      }
      if (!resp.ok && resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 20000));
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 20000));
    }

  }
  const err: any = new Error(
    `Exhausted ${maxAttempts} retries for ${url}: ${String(lastErr ?? lastStatus ?? "unknown")}`,
  );
  err.status = lastStatus;
  throw err;
}

async function pLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

// Run one endpoint call; on exhaustion log to ingest_failures and return null.
async function tryEndpoint(
  supabaseAdmin: any,
  patient_id: string,
  endpoint: string,
  url: string,
  headers: Record<string, string>,
  counters: { http_429s: number },
): Promise<any | null> {
  try {
    const resp = await fetchWithRetry(url, { headers }, counters);
    if (!resp.ok) {
      await supabaseAdmin.from("ingest_failures").insert({
        patient_id, endpoint, status: resp.status, error: `HTTP ${resp.status}`,
      });
      return null;
    }
    // success — clear any prior failure rows for this (patient, endpoint)
    await supabaseAdmin.from("ingest_failures")
      .delete().eq("patient_id", patient_id).eq("endpoint", endpoint);
    return await resp.json();
  } catch (e: any) {
    await supabaseAdmin.from("ingest_failures").insert({
      patient_id, endpoint, status: e?.status ?? null,
      error: String(e?.message ?? e),
    });
    return null;
  }
}

// Fetch all sub-resources for a single patient. Each endpoint is independent —
// one failure logs to ingest_failures but does NOT abort the others.
async function ingestOnePatient(
  supabaseAdmin: any,
  base: string,
  headers: Record<string, string>,
  counters: { http_429s: number },
  pidStr: string,
  pidNum: number,
) {
  // diagnoses
  const dx = await tryEndpoint(
    supabaseAdmin, pidStr, "diagnoses",
    `${base}/pcc/diagnoses?patient_id=${encodeURIComponent(pidStr)}`, headers, counters,
  );
  if (Array.isArray(dx) && dx.length) {
    await supabaseAdmin.from("raw_diagnoses").upsert(
      dx.map((d: any) => ({
        id: String(d.id ?? `${pidStr}-${d.icd10_code ?? d.code ?? Math.random()}`),
        patient_id: pidStr,
        payload: d,
      })),
      { onConflict: "id" },
    );
  }

  // coverage
  const cov = await tryEndpoint(
    supabaseAdmin, pidStr, "coverage",
    `${base}/pcc/coverage?patient_id=${encodeURIComponent(pidStr)}`, headers, counters,
  );
  if (cov != null) {
    await supabaseAdmin.from("raw_coverage").upsert(
      { patient_id: pidStr, payload: cov, fetched_at: new Date().toISOString() },
      { onConflict: "patient_id" },
    );
  }

  // notes
  const notes = await tryEndpoint(
    supabaseAdmin, pidStr, "notes",
    `${base}/pcc/notes?patient_id=${pidNum}`, headers, counters,
  );
  if (Array.isArray(notes) && notes.length) {
    await supabaseAdmin.from("raw_notes").upsert(
      notes.map((n: any) => ({
        id: String(n.pcc_note_id ?? n.id ?? `${pidStr}-n-${Math.random()}`),
        patient_id: pidStr,
        format: n.note_type ?? null,
        body: n.note_text ?? null,
        payload: n,
      })),
      { onConflict: "id" },
    );
  }

  // assessments
  const asmts = await tryEndpoint(
    supabaseAdmin, pidStr, "assessments",
    `${base}/pcc/assessments?patient_id=${pidNum}`, headers, counters,
  );
  if (Array.isArray(asmts) && asmts.length) {
    await supabaseAdmin.from("raw_assessments").upsert(
      asmts.map((a: any) => ({
        id: String(a.pcc_assessment_id ?? a.id ?? `${pidStr}-a-${Math.random()}`),
        patient_id: pidStr,
        payload: a,
      })),
      { onConflict: "id" },
    );
  }
}



// ---------- 1. INGESTION ----------

export const runIngestion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ facility_id: z.union(FACILITY_IDS.map((id) => z.literal(id)) as any) }).parse(input),
  )
  .handler(async ({ data }) => {
    
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const base = process.env.PCC_API_BASE_URL || PCC_BASE_DEFAULT;
    const key = process.env.PCC_API_KEY;

    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const counters = { http_429s: 0 };
    const facilityId = data.facility_id as number;
    const facilityLabel = FACILITIES.find((f) => f.id === facilityId)?.label ?? `Facility ${facilityId}`;

    const { data: run } = await supabaseAdmin
      .from("pipeline_runs")
      .insert({ status: "running", notes: `ingest ${facilityLabel}` })
      .select()
      .single();

    let processed = 0;
    try {
      // Patients endpoint goes first — everything else depends on this list.
      // On failure, wait 20s between attempts (up to 30 tries = ~10 min) so
      // a transient PCC outage doesn't abort the whole facility's run.
      let patients: Array<{
        id: number;
        patient_id: string;
        facility_id: number;
        first_name?: string;
        last_name?: string;
        primary_payer_code?: string;
        [k: string]: unknown;
      }> | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const resp = await fetch(
            `${base}/pcc/patients?facility_id=${facilityId}`,
            { headers },
          );
          if (resp.status === 429) counters.http_429s += 1;
          if (resp.ok) {
            patients = await resp.json();
            break;
          }
          lastErr = new Error(`Patients endpoint HTTP ${resp.status}`);
        } catch (e) {
          lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 20000));
      }
      if (!patients) throw lastErr ?? new Error("patients fetch failed");


      await supabaseAdmin.from("raw_patients").upsert(
        patients.map((p) => ({
          patient_id: p.patient_id, // canonical string id (e.g. FA-001)
          facility: facilityLabel,
          payload: p as any,
          fetched_at: new Date().toISOString(),
        })) as any,
        { onConflict: "patient_id" },
      );

      await pLimit(patients, 4, async (p) => {
        const pidStr = p.patient_id;
        const pidNum = p.id;
        await ingestOnePatient(supabaseAdmin, base, headers, counters, pidStr, pidNum);
        processed++;
      });


      await supabaseAdmin
        .from("pipeline_runs")
        .update({
          finished_at: new Date().toISOString(),
          patients_processed: processed,
          http_429s: counters.http_429s,
          status: "ok",
        })
        .eq("id", run!.id);

      return { ok: true, facility: facilityLabel, processed, http_429s: counters.http_429s };
    } catch (e) {
      await supabaseAdmin
        .from("pipeline_runs")
        .update({
          finished_at: new Date().toISOString(),
          patients_processed: processed,
          http_429s: counters.http_429s,
          status: "error",
          notes: String(e instanceof Error ? e.message : e),
        })
        .eq("id", run!.id);
      throw e;
    }
  });

// ---------- 2. EXTRACTION ----------

function noteAsText(row: { body?: string | null; payload: any; format?: string | null }) {
  if (row.body && row.body.trim()) return row.body;
  // Assessments: PCC ships a structured questionnaire as a JSON string in `raw_json`.
  const rj = row.payload?.raw_json;
  if (typeof rj === "string" && rj.trim()) {
    try {
      const obj = JSON.parse(rj);
      const parts: string[] = [];
      for (const s of obj.sections ?? []) {
        for (const q of s.questions ?? []) {
          if (q.answer) parts.push(`${q.question}: ${q.answer}`);
        }
      }
      if (parts.length) return parts.join("\n");
      return rj;
    } catch {
      return rj;
    }
  }
  try {
    return JSON.stringify(row.payload).slice(0, 6000);
  } catch {
    return "";
  }
}

export const runExtraction = createServerFn({ method: "POST" })
  .handler(async () => {
    
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateText } = await import("ai");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY missing");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    // Already-extracted source_ids
    const { data: doneRows } = await supabaseAdmin
      .from("wound_extractions")
      .select("source_table, source_id")
      .not("wound_type", "is", null);
    const done = new Set((doneRows ?? []).map((r) => `${r.source_table}:${r.source_id}`));

    // Clear previous failed placeholder rows so we retry
    await supabaseAdmin
      .from("wound_extractions")
      .delete()
      .is("wound_type", null);

    const { data: notes } = await supabaseAdmin
      .from("raw_notes")
      .select("id, patient_id, format, body, payload")
      .limit(500);
    const { data: assessments } = await supabaseAdmin
      .from("raw_assessments")
      .select("id, patient_id, payload")
      .limit(500);

    type Item = {
      source_table: "raw_notes" | "raw_assessments";
      source_id: string;
      patient_id: string;
      format: string | null;
      text: string;
    };
    const items: Item[] = [
      ...(notes ?? []).map((n) => ({
        source_table: "raw_notes" as const,
        source_id: n.id,
        patient_id: n.patient_id,
        format: n.format,
        text: noteAsText(n),
      })),
      ...(assessments ?? []).map((a) => ({
        source_table: "raw_assessments" as const,
        source_id: a.id,
        patient_id: a.patient_id,
        format: null,
        text: noteAsText(a as any),
      })),
    ].filter((it) => it.text && !done.has(`${it.source_table}:${it.source_id}`));

    let failures = 0;
    let extracted = 0;

    await pLimit(items, 4, async (item) => {
      try {
        // Try LLM JSON extraction first
        let parsed: { wounds: any[]; extraction_notes: string | null } | null = null;
        try {
          const result = await generateText({
            model,
            system: EXTRACTION_SYSTEM_PROMPT + "\n\nRespond with ONLY valid JSON matching: {\"wounds\":[{\"wound_type\":\"pressure_ulcer|diabetic_ulcer|venous_ulcer|arterial_ulcer|surgical_wound|traumatic_wound|burn|skin_tear|other|none\",\"wound_stage\":\"stage_1|stage_2|stage_3|stage_4|unstageable|deep_tissue_injury|null\",\"location\":\"string|null\",\"length_cm\":number|null,\"width_cm\":number|null,\"depth_cm\":number|null,\"drainage\":\"none|scant|small|moderate|large|null\",\"is_primary_wound\":boolean,\"confidence\":\"high|medium|low\",\"source_quote\":\"string|null\"}],\"extraction_notes\":\"string|null\"}. No prose, no markdown fences.",
            prompt: item.text,
          } as any);
          const raw = (result as any).text as string;
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = null; }
          }
        } catch { /* fallthrough to regex */ }

        // Regex fallback if LLM produced nothing usable
        if (!parsed || !Array.isArray(parsed.wounds)) {
          parsed = regexExtractWounds(item.text);
        }

        if (!parsed.wounds.length) {
          await supabaseAdmin.from("wound_extractions").insert({
            source_table: item.source_table,
            source_id: item.source_id,
            patient_id: item.patient_id,
            wound_type: "none",
            confidence: "high",
            extraction_notes: parsed.extraction_notes ?? "No wound described.",
            raw_json: parsed,
          });
        } else {
          for (const w of parsed.wounds) {
            await supabaseAdmin.from("wound_extractions").upsert(
              {
                source_table: item.source_table,
                source_id: item.source_id,
                patient_id: item.patient_id,
                wound_type: w.wound_type ?? null,
                wound_stage: w.wound_stage ?? null,
                location: w.location ?? null,
                length_cm: w.length_cm ?? null,
                width_cm: w.width_cm ?? null,
                depth_cm: w.depth_cm ?? null,
                drainage: w.drainage ?? null,
                is_primary_wound: w.is_primary_wound ?? null,
                confidence: w.confidence ?? "low",
                extraction_notes: parsed.extraction_notes,
                source_quote: w.source_quote ?? null,
                raw_json: w,
              },
              { onConflict: "source_table,source_id,wound_type,location" },
            );
          }
        }
        extracted++;
      } catch (e) {
        failures++;
        await supabaseAdmin.from("wound_extractions").insert({
          source_table: item.source_table,
          source_id: item.source_id,
          patient_id: item.patient_id,
          confidence: "low",
          extraction_notes: `extraction failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    });

    await supabaseAdmin.from("pipeline_runs").insert({
      finished_at: new Date().toISOString(),
      patients_processed: extracted,
      extraction_failures: failures,
      status: "ok",
      notes: "extraction batch",
    });
    return { ok: true, extracted, failures, considered: items.length };
  });

// ---------- 3. RULES ENGINE ----------

function hasActivePartB(coveragePayload: any): boolean {
  if (!coveragePayload) return false;
  // PCC returns an array of coverage rows; treat object as single-row too.
  const rows: any[] = Array.isArray(coveragePayload) ? coveragePayload : [coveragePayload];
  const now = Date.now();
  return rows.some((r) => {
    const isPartB =
      r.payer_code === "MCB" ||
      /part\s*b|medicare\s*b/i.test(String(r.payer_name ?? r.plan ?? r.coverage ?? r.type ?? ""));
    if (!isPartB) return false;
    const to = r.effective_to ? Date.parse(r.effective_to) : NaN;
    const from = r.effective_from ? Date.parse(r.effective_from) : 0;
    const activeWindow = (!Number.isFinite(to) || to >= now) && (!Number.isFinite(from) || from <= now);
    const status = r.status ?? r.active;
    if (typeof status === "boolean") return status && activeWindow;
    if (typeof status === "string") return /active|true|yes/i.test(status) && activeWindow;
    return activeWindow;
  });
}

export const runRules = createServerFn({ method: "POST" })
  .handler(async () => {
    
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: patients } = await supabaseAdmin
      .from("raw_patients")
      .select("patient_id, facility");
    const { data: coverages } = await supabaseAdmin
      .from("raw_coverage")
      .select("patient_id, payload");
    const covByPid = new Map((coverages ?? []).map((c) => [c.patient_id, c.payload]));

    const { data: extractions } = await supabaseAdmin
      .from("wound_extractions")
      .select(
        "id, source_table, source_id, patient_id, wound_type, wound_stage, location, length_cm, width_cm, depth_cm, drainage, is_primary_wound, confidence, extraction_notes, source_quote",
      );
    const extByPid = new Map<string, ExtractionRow[]>();
    for (const e of extractions ?? []) {
      const arr = extByPid.get(e.patient_id) ?? [];
      arr.push(e as ExtractionRow);
      extByPid.set(e.patient_id, arr);
    }

    const { data: notes } = await supabaseAdmin.from("raw_notes").select("id, format");
    const noteFmt = new Map((notes ?? []).map((n) => [n.id, n.format]));

    let written = 0;
    for (const p of patients ?? []) {
      const ex = extByPid.get(p.patient_id) ?? [];
      const primary = pickPrimary(ex);
      const multi = ex.filter((e) => e.wound_type && e.wound_type !== "none").length > 2;
      const fmt = primary ? noteFmt.get(primary.source_id) ?? null : null;
      const has_partb = hasActivePartB(covByPid.get(p.patient_id));
      const decision = decideEligibility({
        facility: p.facility,
        has_partb,
        primary,
        source_format: fmt,
        multi_wound_ambiguous: multi,
      });
      await supabaseAdmin.from("eligibility_output").upsert(
        {
          patient_id: p.patient_id,
          facility: p.facility,
          decision: decision.decision,
          routing_reason: decision.routing_reason,
          primary_extraction_id: primary?.id ?? null,
          has_partb,
          missing_fields: decision.missing_fields,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" },
      );
      written++;
    }
    return { ok: true, written };
  });

// ---------- 4. ORCHESTRATOR ----------

export const runFullPipeline = createServerFn({ method: "POST" })
  .handler(async () => {
    
    return { ok: true as const, note: "Run each step from /runs." };
  });

// ---------- Dashboard reads ----------

export const getDashboard = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("eligibility_output")
      .select("*")
      .order("facility")
      .order("decision");
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const ids = rows.map((r: any) => r.patient_id);
    const nameById: Record<string, string> = {};
    if (ids.length) {
      const { data: pats } = await supabaseAdmin
        .from("raw_patients")
        .select("patient_id,payload")
        .in("patient_id", ids);
      for (const p of pats ?? []) {
        const pl: any = (p as any).payload ?? {};
        const name = [pl.first_name, pl.last_name].filter(Boolean).join(" ").trim();
        if (name) nameById[(p as any).patient_id] = name;
      }
    }
    return rows.map((r: any) => ({ ...r, patient_name: nameById[r.patient_id] ?? null }));
  });

export const getPatientDetail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ patient_id: z.string() }).parse(input),
  )
  .handler(async ({ data }) => {
    const pid = data.patient_id;
    const [elig, extractions, notes, coverage] = await Promise.all([
      (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("eligibility_output").select("*").eq("patient_id", pid).maybeSingle(),
      (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("wound_extractions").select("*").eq("patient_id", pid),
      (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("raw_notes").select("*").eq("patient_id", pid),
      (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("raw_coverage").select("*").eq("patient_id", pid).maybeSingle(),
    ]);
    return {
      eligibility: elig.data ?? null,
      extractions: extractions.data ?? [],
      notes: notes.data ?? [],
      coverage: coverage.data ?? null,
    };
  });

export const getRuns = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data, error } = await (await import("@/integrations/supabase/client.server")).supabaseAdmin
      .from("pipeline_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getTableCounts = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tables = [
      "raw_patients", "raw_diagnoses", "raw_coverage", "raw_notes",
      "raw_assessments", "wound_extractions", "eligibility_output", "ingest_failures",
    ] as const;
    const counts = await Promise.all(
      tables.map(async (t) => {
        const { count } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
        return { table: t, count: count ?? 0 };
      }),
    );
    return counts;
  });


// ---------- 5. BACKFILL ----------
// Re-fetch sub-resources for any patient missing data, and drain ingest_failures.
// Caller (UI) invokes this repeatedly until counters report no more missing.
export const runBackfill = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const base = process.env.PCC_API_BASE_URL || PCC_BASE_DEFAULT;
    const key = process.env.PCC_API_KEY;
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const counters = { http_429s: 0 };

    // Build set of patient_ids that are missing any of the 4 sub-resources.
    const { data: patients = [] } = await supabaseAdmin
      .from("raw_patients")
      .select("patient_id, payload");

    const [{ data: dx = [] }, { data: cov = [] }, { data: notes = [] }, { data: asmts = [] }] =
      await Promise.all([
        supabaseAdmin.from("raw_diagnoses").select("patient_id"),
        supabaseAdmin.from("raw_coverage").select("patient_id"),
        supabaseAdmin.from("raw_notes").select("patient_id"),
        supabaseAdmin.from("raw_assessments").select("patient_id"),
      ]);

    const hasDx = new Set((dx ?? []).map((r: any) => r.patient_id));
    const hasCov = new Set((cov ?? []).map((r: any) => r.patient_id));
    const hasNotes = new Set((notes ?? []).map((r: any) => r.patient_id));
    const hasAsmts = new Set((asmts ?? []).map((r: any) => r.patient_id));

    // Also include patients referenced by recent ingest_failures.
    const { data: fails = [] } = await supabaseAdmin
      .from("ingest_failures")
      .select("patient_id")
      .limit(2000);
    const failingPids = new Set((fails ?? []).map((f: any) => f.patient_id).filter(Boolean));

    const candidates = (patients ?? []).filter((p: any) => {
      const pid = p.patient_id;
      return failingPids.has(pid) ||
        !hasDx.has(pid) || !hasCov.has(pid) ||
        !hasNotes.has(pid) || !hasAsmts.has(pid);
    });

    // Cap per call so we stay within worker time budget; UI loops until 0.
    const batch = candidates.slice(0, 25);

    let attempted = 0;
    await pLimit(batch, 4, async (p: any) => {
      const pidStr = p.patient_id;
      const pidNum = (p.payload as any)?.id;
      if (pidNum == null) return;
      await ingestOnePatient(supabaseAdmin, base, headers, counters, pidStr, pidNum);
      attempted++;
    });

    // Report what's still missing across the whole table after this pass.
    const remaining = candidates.length - batch.length;

    return {
      ok: true,
      attempted,
      remaining_candidates: remaining,
      http_429s: counters.http_429s,
    };
  });

