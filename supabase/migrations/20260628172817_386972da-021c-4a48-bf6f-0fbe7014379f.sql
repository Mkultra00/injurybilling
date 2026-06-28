
-- Restrict PHI / ops tables to admin role only
DROP POLICY IF EXISTS "auth read raw_patients" ON public.raw_patients;
DROP POLICY IF EXISTS "auth read raw_notes" ON public.raw_notes;
DROP POLICY IF EXISTS "auth read raw_diagnoses" ON public.raw_diagnoses;
DROP POLICY IF EXISTS "auth read raw_assessments" ON public.raw_assessments;
DROP POLICY IF EXISTS "auth read raw_coverage" ON public.raw_coverage;
DROP POLICY IF EXISTS "auth read wound_extractions" ON public.wound_extractions;
DROP POLICY IF EXISTS "auth read eligibility_output" ON public.eligibility_output;
DROP POLICY IF EXISTS "auth read pipeline_runs" ON public.pipeline_runs;
DROP POLICY IF EXISTS "auth read ingest_failures" ON public.ingest_failures;

CREATE POLICY "admin read raw_patients" ON public.raw_patients FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read raw_notes" ON public.raw_notes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read raw_diagnoses" ON public.raw_diagnoses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read raw_assessments" ON public.raw_assessments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read raw_coverage" ON public.raw_coverage FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read wound_extractions" ON public.wound_extractions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read eligibility_output" ON public.eligibility_output FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read pipeline_runs" ON public.pipeline_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin read ingest_failures" ON public.ingest_failures FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Remove circular admin INSERT on user_roles; admins can still update/delete, but inserts must go via service role / migration
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT policy: role grants must be done via service_role (server function or migration)
