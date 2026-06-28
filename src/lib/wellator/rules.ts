import type { Decision, ExtractionRow } from "./types";

const BILLABLE_TYPES = new Set([
  "pressure_ulcer",
  "diabetic_foot_ulcer",
  "venous_ulcer",
  "arterial_ulcer",
  "surgical_site_infection",
  "abscess",
  "burn",
]);

const STAGE_RANK: Record<string, number> = {
  unstageable: 5,
  "4": 4,
  "3": 3,
  "2": 2,
};

export function pickPrimary(extractions: ExtractionRow[]): ExtractionRow | null {
  const billable = extractions.filter(
    (e) => e.wound_type && BILLABLE_TYPES.has(e.wound_type),
  );
  if (billable.length === 0) return null;
  return [...billable].sort((a, b) => {
    const stageA = STAGE_RANK[a.wound_stage ?? ""] ?? 0;
    const stageB = STAGE_RANK[b.wound_stage ?? ""] ?? 0;
    if (stageB !== stageA) return stageB - stageA;
    const areaA = (a.length_cm ?? 0) * (a.width_cm ?? 0);
    const areaB = (b.length_cm ?? 0) * (b.width_cm ?? 0);
    return areaB - areaA;
  })[0];
}

export type RulesInput = {
  facility: string;
  has_partb: boolean;
  primary: ExtractionRow | null;
  source_format?: string | null;
  multi_wound_ambiguous?: boolean;
};

export type RulesResult = {
  decision: Decision;
  routing_reason: string;
  missing_fields: string[];
};

export function decideEligibility(input: RulesInput): RulesResult {
  if (!input.has_partb) {
    return {
      decision: "reject",
      routing_reason:
        "Patient does not have active Medicare Part B coverage; not eligible for Part B wound billing.",
      missing_fields: [],
    };
  }
  if (!input.primary) {
    return {
      decision: "reject",
      routing_reason:
        "No classifiable, billable wound documented across this patient's notes and assessments.",
      missing_fields: ["wound_type"],
    };
  }
  const p = input.primary;
  const missing: string[] = [];
  if (p.length_cm == null) missing.push("length_cm");
  if (p.width_cm == null) missing.push("width_cm");
  if (p.depth_cm == null) missing.push("depth_cm");
  if (!p.drainage) missing.push("drainage");

  if (missing.length > 0) {
    return {
      decision: "flag_for_review",
      routing_reason: `Required wound documentation missing: ${missing.join(", ")}. Source note did not mention these.`,
      missing_fields: missing,
    };
  }
  if (input.source_format === "Envive" && p.confidence !== "high") {
    return {
      decision: "flag_for_review",
      routing_reason:
        "Envive narrative-only note with non-high extraction confidence; manual review recommended.",
      missing_fields: [],
    };
  }
  if (input.multi_wound_ambiguous) {
    return {
      decision: "flag_for_review",
      routing_reason:
        "Multiple wounds documented with ambiguous primary selection; verify which wound is being billed.",
      missing_fields: [],
    };
  }
  if (p.confidence === "low") {
    return {
      decision: "flag_for_review",
      routing_reason: "Low extraction confidence on primary wound; verify against source note.",
      missing_fields: [],
    };
  }
  return {
    decision: "auto_accept",
    routing_reason: `Active Part B coverage, ${p.wound_type?.replace(/_/g, " ")} at ${p.location ?? "documented location"}, full measurements and drainage documented.`,
    missing_fields: [],
  };
}
