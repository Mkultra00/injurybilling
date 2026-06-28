import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRuns, runIngestion, runExtraction, runRules, runBackfill, FACILITIES } from "@/lib/pipeline.functions";
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

  const [backfillState, setBackfillState] = (require("react") as typeof import("react")).useState<{
    running: boolean; passes: number; remaining: number; attempted: number;
  }>({ running: false, passes: 0, remaining: 0, attempted: 0 });


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
    mutationFn: () => rules(),
    onSuccess: (r) => {
      toast.success(`Decisions written for ${r.written} patients`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rules failed"),
  });

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
            <CardTitle className="text-base">Run the pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                Step 2 — Extract wound fields with Lovable AI
              </div>
              <Button onClick={() => extract.mutate()} disabled={extract.isPending}>
                {extract.isPending ? "Extracting…" : "Run extraction"}
              </Button>
            </div>
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                Step 3 — Apply deterministic eligibility rules
              </div>
              <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
                {decide.isPending ? "Deciding…" : "Run rules engine"}
              </Button>
            </div>
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
