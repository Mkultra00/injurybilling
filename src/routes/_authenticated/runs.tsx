import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRuns, runIngestion, runExtraction, runRules, runBackfill, getTableCounts, previewRules, FACILITIES } from "@/lib/pipeline.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import brandAvatar from "@/assets/golden-dawn-avatar.webp.asset.json";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/runs")({
  head: () => ({
    meta: [
      { title: "Wellator — Pipeline runs" },
      { name: "description", content: "Ingestion and extraction history for the Wellator pipeline." },
    ],
  }),
  component: RunsPage,
});

function RunsPage() {
  const getR = useServerFn(getRuns);
  const ing = useServerFn(runIngestion);
  const ext = useServerFn(runExtraction);
  const rules = useServerFn(runRules);
  const backfill = useServerFn(runBackfill);
  const qc = useQueryClient();

  const { data: runs = [] } = useQuery({ queryKey: ["runs"], queryFn: () => getR() });
  const getCounts = useServerFn(getTableCounts);
  const { data: counts = [] } = useQuery({
    queryKey: ["table-counts"],
    queryFn: () => getCounts(),
    refetchInterval: 5000,
  });


  const [backfillState, setBackfillState] = useState<{
    running: boolean; passes: number; remaining: number; attempted: number;
  }>({ running: false, passes: 0, remaining: 0, attempted: 0 });

  type StepStatus = "pending" | "running" | "done" | "error";
  type StepKey = "ingest_101" | "ingest_102" | "ingest_103" | "backfill" | "extract" | "rules";
  const initialSteps: { key: StepKey; label: string; status: StepStatus; detail?: string }[] = [
    { key: "ingest_101", label: "Ingest Facility A (101)", status: "pending" },
    { key: "ingest_102", label: "Ingest Facility B (102)", status: "pending" },
    { key: "ingest_103", label: "Ingest Facility C (103)", status: "pending" },
    { key: "backfill", label: "Backfill missing", status: "pending" },
    { key: "extract", label: "Extract wounds", status: "pending" },
    { key: "rules", label: "Apply rules", status: "pending" },
  ];
  const [allRunning, setAllRunning] = useState(false);
  const [steps, setSteps] = useState(initialSteps);
  const updateStep = (key: StepKey, status: StepStatus, detail?: string) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail } : s)));

  async function runAll() {
    setSteps(initialSteps);
    setAllRunning(true);
    try {
      for (const f of FACILITIES) {
        const key = `ingest_${f.id}` as StepKey;
        updateStep(key, "running");
        try {
          const r = await ing({ data: { facility_id: f.id } });
          updateStep(key, "done", `${r.processed} patients, ${r.http_429s} 429s`);
        } catch (e) {
          updateStep(key, "error", e instanceof Error ? e.message : "failed");
          throw e;
        }
      }
      updateStep("backfill", "running");
      try {
        await runBackfillLoop((p) => updateStep("backfill", "running", p));
        updateStep("backfill", "done");
      } catch (e) {
        updateStep("backfill", "error", e instanceof Error ? e.message : "failed");
        throw e;
      }
      updateStep("extract", "running");
      try {
        const ex = await ext();
        updateStep("extract", "done", `${ex.extracted} done / ${ex.failures} failed`);
      } catch (e) {
        updateStep("extract", "error", e instanceof Error ? e.message : "failed");
        throw e;
      }
      updateStep("rules", "running");
      try {
        const dr = await rules({ data: {} });
        updateStep("rules", "done", `${dr.written} decisions`);
      } catch (e) {
        updateStep("rules", "error", e instanceof Error ? e.message : "failed");
        throw e;
      }
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["table-counts"] });
      toast.success("Full pipeline complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pipeline failed");
    } finally {
      setAllRunning(false);
    }
  }

  async function runBackfillLoop(onProgress?: (msg: string) => void) {
    setBackfillState({ running: true, passes: 0, remaining: 0, attempted: 0 });
    let totalAttempted = 0;
    for (let pass = 1; pass <= 50; pass++) {
      try {
        const r = await backfill();
        totalAttempted += r.attempted;
        setBackfillState({
          running: r.remaining_candidates > 0 || r.attempted > 0,
          passes: pass,
          remaining: r.remaining_candidates,
          attempted: totalAttempted,
        });
        onProgress?.(`pass ${pass}, ${r.remaining_candidates} remaining`);
        if (r.attempted === 0 && r.remaining_candidates === 0) {
          toast.success(`Backfill complete — ${totalAttempted} patients reattempted across ${pass} passes`);
          break;
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Backfill error");
        break;
      }
    }
    setBackfillState((s) => ({ ...s, running: false }));
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }



  const useIngestFor = (facility_id: number) =>
    useMutation({
      mutationKey: ["ingest", facility_id],
      mutationFn: () => ing({ data: { facility_id } }),
      onSuccess: (r) => {
        toast.success(`Ingested ${r.facility}: ${r.processed} patients (${r.http_429s} 429s)`);
        qc.invalidateQueries({ queryKey: ["runs"] });
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Ingestion failed"),
    });
  const ingestA = useIngestFor(101);
  const ingestB = useIngestFor(102);
  const ingestC = useIngestFor(103);
  const ingestByFacility: Record<number, ReturnType<typeof useIngestFor>> = {
    101: ingestA,
    102: ingestB,
    103: ingestC,
  };
  const extract = useMutation({
    mutationFn: () => ext(),
    onSuccess: (r) =>
      toast.success(`Extraction: ${r.extracted} done, ${r.failures} failed (of ${r.considered})`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Extraction failed"),
  });
  const decide = useMutation({
    mutationFn: (patient_ids?: string[]) => rules({ data: patient_ids ? { patient_ids } : {} }),
    onSuccess: (r) => {
      toast.success(`Decisions written for ${r.written} patients`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["rules-preview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rules failed"),
  });

  // ----- Preview / commit auto-accepts -----
  const previewFn = useServerFn(previewRules);
  const [showPreview, setShowPreview] = useState(false);
  const preview = useQuery({
    queryKey: ["rules-preview"],
    queryFn: () => previewFn(),
    enabled: showPreview,
  });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [decisionFilter, setDecisionFilter] = useState<"auto_accept" | "flag_for_review" | "reject" | "all">("auto_accept");
  const filteredRows = (preview.data?.rows ?? []).filter(
    (r) => decisionFilter === "all" || r.decision === decisionFilter,
  );
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const allChecked = filteredRows.length > 0 && filteredRows.every((r) => selected[r.patient_id]);
  const toggleAll = () => {
    const next = { ...selected };
    if (allChecked) filteredRows.forEach((r) => delete next[r.patient_id]);
    else filteredRows.forEach((r) => (next[r.patient_id] = true));
    setSelected(next);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4">
          <div className="flex items-center gap-6">
            <Avatar className="h-32 w-32 border">
              <AvatarImage src={brandAvatar.url} alt="Golden Dawn Billing" />
              <AvatarFallback>GD</AvatarFallback>
            </Avatar>
            <h1 className="text-5xl font-semibold">Golden Dawn Billing — Pipeline runs</h1>
          </div>
          <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Dashboard
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Table row counts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {counts.map((c) => (
                <div key={c.table} className="rounded-md border p-3">
                  <div className="truncate text-xs font-medium text-muted-foreground">{c.table}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{c.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run the pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  Run everything — ingest → backfill → extract → rules
                </div>
                <Button onClick={runAll} disabled={allRunning} size="lg">
                  {allRunning ? "Running…" : "Run full pipeline"}
                </Button>
              </div>
              <ol className="space-y-1.5">
                {steps.map((s, i) => {
                  const icon =
                    s.status === "done" ? "✓" :
                    s.status === "running" ? "●" :
                    s.status === "error" ? "✕" : "○";
                  const color =
                    s.status === "done" ? "text-green-600" :
                    s.status === "running" ? "text-primary animate-pulse" :
                    s.status === "error" ? "text-destructive" : "text-muted-foreground";
                  return (
                    <li key={s.key} className="flex items-start gap-2 text-sm">
                      <span className={`w-5 text-center font-mono ${color}`}>{icon}</span>
                      <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                      <span className={s.status === "pending" ? "text-muted-foreground" : ""}>{s.label}</span>
                      {s.detail && (
                        <span className="text-xs text-muted-foreground">— {s.detail}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                Step 1 — Ingest from PCC (per facility; rate-limit aware)
              </div>
              <div className="flex flex-wrap gap-2">
                {FACILITIES.map((f) => {
                  const m = ingestByFacility[f.id];
                  return (
                    <Button
                      key={f.id}
                      onClick={() => m.mutate()}
                      disabled={m.isPending}
                    >
                      {m.isPending ? `Ingesting ${f.label}…` : `Ingest ${f.label}`}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                Step 1b — Backfill missing data (20-retry, drains failure queue, loops until done)
              </div>
              <Button onClick={() => runBackfillLoop()} disabled={backfillState.running} variant="secondary">
                {backfillState.running
                  ? `Backfilling… pass ${backfillState.passes}, ${backfillState.remaining} remaining`
                  : "Backfill missing"}
              </Button>
              {backfillState.attempted > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Reattempted {backfillState.attempted} patients across {backfillState.passes} passes.
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                Step 2 — Extract wound fields with Lovable AI
              </div>
              <Button onClick={() => extract.mutate()} disabled={extract.isPending}>
                {extract.isPending ? "Extracting…" : "Run extraction"}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Step 3 — Apply deterministic eligibility rules
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => { setShowPreview(true); preview.refetch(); }}
                  disabled={preview.isFetching}
                >
                  {preview.isFetching ? "Computing preview…" : "Preview decisions"}
                </Button>
                <Button onClick={() => decide.mutate(undefined)} disabled={decide.isPending}>
                  {decide.isPending ? "Deciding…" : "Commit all decisions"}
                </Button>
              </div>
            </div>

            {showPreview && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium">Preview — no rows committed yet</div>
                  {preview.data && (
                    <div className="flex gap-2 text-xs">
                      <Badge variant="default">auto_accept: {preview.data.counts.auto_accept}</Badge>
                      <Badge variant="secondary">flag: {preview.data.counts.flag_for_review}</Badge>
                      <Badge variant="destructive">reject: {preview.data.counts.reject}</Badge>
                      <span className="text-muted-foreground">total: {preview.data.counts.total}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["auto_accept", "flag_for_review", "reject", "all"] as const).map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={decisionFilter === d ? "default" : "outline"}
                      onClick={() => { setDecisionFilter(d); setSelected({}); }}
                    >
                      {d}
                    </Button>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
                    <Button
                      size="sm"
                      disabled={selectedIds.length === 0 || decide.isPending}
                      onClick={() => decide.mutate(selectedIds)}
                    >
                      Commit selected ({selectedIds.length})
                    </Button>
                  </div>
                </div>
                <div className="max-h-[480px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                        </TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Decision</TableHead>
                        <TableHead>Primary wound</TableHead>
                        <TableHead>Measurements</TableHead>
                        <TableHead>Reason / matches</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.slice(0, 500).map((r) => {
                        const p = r.primary;
                        const meas = p
                          ? [p.length_cm, p.width_cm, p.depth_cm]
                              .map((v) => (v == null ? "—" : `${v}`))
                              .join(" × ") + " cm"
                          : "—";
                        return (
                          <TableRow key={r.patient_id}>
                            <TableCell>
                              <Checkbox
                                checked={!!selected[r.patient_id]}
                                onCheckedChange={(v) =>
                                  setSelected((s) => ({ ...s, [r.patient_id]: !!v }))
                                }
                              />
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium">{r.patient_name ?? r.patient_id}</div>
                              <div className="text-muted-foreground">{r.patient_id}</div>
                              {r.has_partb ? null : (
                                <Badge variant="destructive" className="mt-1">no Part B</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{r.facility}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.decision === "auto_accept"
                                    ? "default"
                                    : r.decision === "flag_for_review"
                                    ? "secondary"
                                    : "destructive"
                                }
                              >
                                {r.decision}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {p ? (
                                <>
                                  <div>{p.wound_type?.replace(/_/g, " ") ?? "—"}</div>
                                  <div className="text-muted-foreground">
                                    {p.location ?? "—"}
                                    {p.wound_stage ? ` · stage ${p.wound_stage}` : ""}
                                    {p.confidence ? ` · conf ${p.confidence}` : ""}
                                  </div>
                                </>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {meas}
                              {p?.drainage ? <div className="text-muted-foreground">drainage: {p.drainage}</div> : null}
                            </TableCell>
                            <TableCell className="text-xs max-w-[360px]">
                              {r.routing_reason}
                              {r.missing_fields.length > 0 && (
                                <div className="text-muted-foreground">missing: {r.missing_fields.join(", ")}</div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                            No rows for this filter.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {filteredRows.length > 500 && (
                    <div className="p-2 text-xs text-muted-foreground">
                      Showing first 500 of {filteredRows.length}.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>429s</TableHead>
                  <TableHead>Extr. failures</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.started_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "ok" ? "default" : "destructive"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.patients_processed ?? 0}</TableCell>
                    <TableCell>{r.http_429s ?? 0}</TableCell>
                    <TableCell>{r.extraction_failures ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
