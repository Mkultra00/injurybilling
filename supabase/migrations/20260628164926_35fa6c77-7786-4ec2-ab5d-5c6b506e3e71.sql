
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated-at helper
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Raw layer
CREATE TABLE public.raw_patients (
  patient_id TEXT PRIMARY KEY,
  facility TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.raw_patients TO authenticated;
GRANT ALL ON public.raw_patients TO service_role;
ALTER TABLE public.raw_patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_patients" ON public.raw_patients FOR SELECT TO authenticated USING (true);

CREATE TABLE public.raw_diagnoses (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.raw_diagnoses (patient_id);
GRANT SELECT ON public.raw_diagnoses TO authenticated;
GRANT ALL ON public.raw_diagnoses TO service_role;
ALTER TABLE public.raw_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_diagnoses" ON public.raw_diagnoses FOR SELECT TO authenticated USING (true);

CREATE TABLE public.raw_coverage (
  patient_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.raw_coverage TO authenticated;
GRANT ALL ON public.raw_coverage TO service_role;
ALTER TABLE public.raw_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_coverage" ON public.raw_coverage FOR SELECT TO authenticated USING (true);

CREATE TABLE public.raw_notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  format TEXT,
  body TEXT,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.raw_notes (patient_id);
GRANT SELECT ON public.raw_notes TO authenticated;
GRANT ALL ON public.raw_notes TO service_role;
ALTER TABLE public.raw_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_notes" ON public.raw_notes FOR SELECT TO authenticated USING (true);

CREATE TABLE public.raw_assessments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.raw_assessments (patient_id);
GRANT SELECT ON public.raw_assessments TO authenticated;
GRANT ALL ON public.raw_assessments TO service_role;
ALTER TABLE public.raw_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_assessments" ON public.raw_assessments FOR SELECT TO authenticated USING (true);

CREATE TABLE public.ingest_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT,
  endpoint TEXT NOT NULL,
  status INT,
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ingest_failures TO authenticated;
GRANT ALL ON public.ingest_failures TO service_role;
ALTER TABLE public.ingest_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ingest_failures" ON public.ingest_failures FOR SELECT TO authenticated USING (true);

-- Extraction layer
CREATE TABLE public.wound_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  wound_type TEXT,
  wound_stage TEXT,
  location TEXT,
  length_cm NUMERIC,
  width_cm NUMERIC,
  depth_cm NUMERIC,
  drainage TEXT,
  is_primary_wound BOOLEAN DEFAULT false,
  confidence TEXT,
  extraction_notes TEXT,
  source_quote TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, wound_type, location)
);
CREATE INDEX ON public.wound_extractions (patient_id);
GRANT SELECT ON public.wound_extractions TO authenticated;
GRANT ALL ON public.wound_extractions TO service_role;
ALTER TABLE public.wound_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read wound_extractions" ON public.wound_extractions FOR SELECT TO authenticated USING (true);

-- Decision layer
CREATE TABLE public.eligibility_output (
  patient_id TEXT PRIMARY KEY,
  facility TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('auto_accept','flag_for_review','reject')),
  routing_reason TEXT NOT NULL,
  primary_extraction_id UUID REFERENCES public.wound_extractions(id) ON DELETE SET NULL,
  has_partb BOOLEAN NOT NULL DEFAULT false,
  missing_fields TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.eligibility_output (facility, decision);
GRANT SELECT ON public.eligibility_output TO authenticated;
GRANT ALL ON public.eligibility_output TO service_role;
ALTER TABLE public.eligibility_output ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read eligibility_output" ON public.eligibility_output FOR SELECT TO authenticated USING (true);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.eligibility_output FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Pipeline runs
CREATE TABLE public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  patients_processed INT DEFAULT 0,
  http_429s INT DEFAULT 0,
  extraction_failures INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  notes TEXT
);
GRANT SELECT ON public.pipeline_runs TO authenticated;
GRANT ALL ON public.pipeline_runs TO service_role;
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read pipeline_runs" ON public.pipeline_runs FOR SELECT TO authenticated USING (true);
