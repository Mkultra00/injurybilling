import { z } from "zod";

// Lenient schema: every field is optional + nullable, enums fall back to null
// if the model returns an unexpected value, so a single bad field does not
// throw away the rest of the extraction.

const woundTypeEnum = z.enum([
  "pressure_ulcer",
  "diabetic_foot_ulcer",
  "venous_ulcer",
  "arterial_ulcer",
  "surgical_site_infection",
  "abscess",
  "burn",
  "other",
  "none",
]);

const woundStageEnum = z.enum(["2", "3", "4", "unstageable"]);
const drainageEnum = z.enum(["none", "light", "moderate", "heavy"]);
const confidenceEnum = z.enum(["high", "medium", "low"]);

// Coerce: accept anything; if it doesn't match, return null instead of throwing.
const safeEnum = <T extends z.ZodEnum<any>>(e: T) =>
  z.preprocess((v) => {
    if (v === null || v === undefined || v === "") return null;
    const parsed = e.safeParse(v);
    return parsed.success ? parsed.data : null;
  }, e.nullable());

const safeNumber = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

const safeString = z.preprocess(
  (v) => (v === null || v === undefined ? null : String(v)),
  z.string().nullable(),
);

const safeBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return false;
}, z.boolean());

export const WoundSchema = z
  .object({
    wound_type: safeEnum(woundTypeEnum),
    wound_stage: safeEnum(woundStageEnum),
    location: safeString,
    length_cm: safeNumber,
    width_cm: safeNumber,
    depth_cm: safeNumber,
    drainage: safeEnum(drainageEnum),
    is_primary_wound: safeBool,
    confidence: z.preprocess((v) => {
      const parsed = confidenceEnum.safeParse(v);
      return parsed.success ? parsed.data : "low";
    }, confidenceEnum),
    source_quote: safeString,
  })
  .partial()
  .passthrough();

export const ExtractionSchema = z
  .object({
    wounds: z.array(z.any()).default([]).transform((arr) =>
      arr
        .map((w) => {
          const parsed = WoundSchema.safeParse(w);
          return parsed.success ? parsed.data : null;
        })
        .filter((w): w is NonNullable<typeof w> => w !== null),
    ),
    extraction_notes: safeString.optional(),
  })
  .passthrough();

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
- extraction_notes: short free-text note explaining anything unusual (multi-wound selection, ambiguity).
- If you are unsure about any single field, set it to null rather than skipping the whole wound — partial wounds are still useful.`;
