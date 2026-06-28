import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

type ToolRequest = {
  tool: "facility_summary" | "list_patients" | "patient_detail" | "explain_decision";
  args?: {
    facility?: string | null;
    decision?: string | null;
    patient_id?: string | null;
    limit?: number | null;
  };
};

function refusal(message: string) {
  return Response.json({ error: "informational_only", message }, { status: 200 });
}

export const Route = createFileRoute("/api/public/voice-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
        if (!secret) return new Response("Server not configured", { status: 500 });

        const raw = await request.text();
        const sig = request.headers.get("x-webhook-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let body: ToolRequest;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const sb = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const args = body.args ?? {};

        try {
          if (body.tool === "facility_summary") {
            const facility = args.facility ?? null;
            let q = sb.from("eligibility_output").select("decision, routing_reason, facility");
            if (facility) q = q.eq("facility", facility);
            const { data, error } = await q;
            if (error) throw error;
            const counts = { auto_accept: 0, flag_for_review: 0, reject: 0 };
            const flagReasons: Record<string, number> = {};
            for (const r of data ?? []) {
              counts[r.decision as keyof typeof counts]++;
              if (r.decision === "flag_for_review") {
                flagReasons[r.routing_reason] = (flagReasons[r.routing_reason] ?? 0) + 1;
              }
            }
            const top = Object.entries(flagReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            return Response.json({
              facility: facility ?? "all",
              auto_accept: counts.auto_accept,
              flag_for_review: counts.flag_for_review,
              reject: counts.reject,
              top_flag_reason: top,
            });
          }

          if (body.tool === "list_patients") {
            const limit = Math.min(args.limit ?? 10, 25);
            let q = sb
              .from("eligibility_output")
              .select("patient_id, facility, decision, routing_reason")
              .limit(limit);
            if (args.facility) q = q.eq("facility", args.facility);
            if (args.decision) q = q.eq("decision", args.decision);
            const { data, error } = await q;
            if (error) throw error;
            return Response.json({
              count: data?.length ?? 0,
              patients: (data ?? []).map((r) => ({
                patient_id: r.patient_id,
                facility: r.facility,
                decision: r.decision,
                reason: r.routing_reason,
              })),
            });
          }

          if (body.tool === "patient_detail" || body.tool === "explain_decision") {
            const pid = args.patient_id;
            if (!pid) return Response.json({ error: "patient_id required" }, { status: 400 });
            const { data: elig } = await sb
              .from("eligibility_output")
              .select("*")
              .eq("patient_id", pid)
              .maybeSingle();
            if (!elig) return Response.json({ error: "not_found" }, { status: 404 });
            const { data: primary } = elig.primary_extraction_id
              ? await sb
                  .from("wound_extractions")
                  .select("*")
                  .eq("id", elig.primary_extraction_id)
                  .maybeSingle()
              : { data: null };

            if (body.tool === "explain_decision") {
              return Response.json({
                patient_id: pid,
                decision: elig.decision,
                reason: elig.routing_reason,
                source_quote: primary?.source_quote ?? null,
              });
            }
            return Response.json({
              patient_id: pid,
              facility: elig.facility,
              decision: elig.decision,
              wound_type: primary?.wound_type ?? null,
              stage: primary?.wound_stage ?? null,
              location: primary?.location ?? null,
              measurements: {
                length_cm: primary?.length_cm ?? null,
                width_cm: primary?.width_cm ?? null,
                depth_cm: primary?.depth_cm ?? null,
              },
              drainage: primary?.drainage ?? null,
              has_partb: elig.has_partb,
              confidence: primary?.confidence ?? null,
              missing_fields: elig.missing_fields,
              reason: elig.routing_reason,
            });
          }

          return refusal("Routing decisions stay in the dashboard.");
        } catch (e) {
          return Response.json(
            { error: "server_error", message: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () =>
        new Response(
          JSON.stringify({
            usage: "POST { tool, args } with x-webhook-signature: hex(hmac-sha256(body, ELEVENLABS_WEBHOOK_SECRET))",
            tools: ["facility_summary", "list_patients", "patient_detail", "explain_decision"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  },
});
