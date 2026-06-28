import { z } from "zod";

export const WoundSchema = z.object({
  wound_type: z
    .enum([
      "pressure_ulcer",
      "diabetic_foot_ulcer",
      "venous_ulcer",
      "arterial_ulcer",
      "surgical_site_infection",
      "abscess",
      "burn",
      "other",
      "none",
    ])
    .nullable(),
  wound_stage: z.enum(["2", "3", "4", "unstageable"]).nullable(),
  location: z.string().nullable(),
  length_cm: z.number().nullable(),
  width_cm: z.number().nullable(),
  depth_cm: z.number().nullable(),
  drainage: z.enum(["none", "light", "moderate", "heavy"]).nullable(),
  is_primary_wound: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  source_quote: z.string().nullable(),
});

export const ExtractionSchema = z.object({
  wounds: z.array(WoundSchema),
  extraction_notes: z.string().nullable(),
});

export type ExtractionOutput = z.infer<typeof ExtractionSchema>;
export type WoundOutput = z.infer<typeof WoundSchema>;

export const EXTRACTION_SYSTEM_PROMPT = `You are a clinical wound-care data extractor.
Read the wound note or assessment and return STRICT JSON matching the requested schema.

Rules:
- Extract every wound described. If none, return an empty wounds array.
- wound_type must be one of the enum values. Use "none" only if no wound at all is described.
- length_cm/width_cm/depth_cm are numbers in centimeters. Use null if not stated. Do NOT guess.
- drainage is null if not mentioned. Do not infer.
- is_primary_wound: set true on at most one wound (the most billable / highest stage / largest), false on all others. If only one wound, set true.
- source_quote: the verbatim snippet from the note that supports your extraction (max ~120 chars).
- confidence: "high" if all fields are explicit, "medium" if some fields are inferred, "low" if the text is ambiguous or partial.
- extraction_notes: short free-text note explaining anything unusual (multi-wound selection, ambiguity).`;
