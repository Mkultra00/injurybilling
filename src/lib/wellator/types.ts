export type Decision = "auto_accept" | "flag_for_review" | "reject";
export type Confidence = "high" | "medium" | "low";
export type Drainage = "none" | "light" | "moderate" | "heavy";

export type EligibilityRow = {
  patient_id: string;
  facility: string;
  decision: Decision;
  routing_reason: string;
  primary_extraction_id: string | null;
  has_partb: boolean;
  missing_fields: string[];
  updated_at: string;
};

export type ExtractionRow = {
  id: string;
  source_table: string;
  source_id: string;
  patient_id: string;
  wound_type: string | null;
  wound_stage: string | null;
  location: string | null;
  length_cm: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  drainage: Drainage | null;
  is_primary_wound: boolean | null;
  confidence: Confidence | null;
  extraction_notes: string | null;
  source_quote: string | null;
};
