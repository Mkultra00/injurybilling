import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getDashboard, getPatientDetail } from "@/lib/pipeline.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Wellator — Dashboard" },
      { name: "description", content: "Wound-care billing routing decisions across facilities." },
    ],
  }),
  component: Dashboard,
});

const DECISION_COLORS: Record<string, string> = {
  auto_accept: "bg-green-100 text-green-900 border-green-300",
  flag_for_review: "bg-amber-100 text-amber-900 border-amber-300",
  reject: "bg-red-100 text-red-900 border-red-300",
};

function Dashboard() {
  const navigate = useNavigate();
  const get = useServerFn(getDashboard);
  const detail = useServerFn(getPatientDetail);
  const qc = useQueryClient();
  const [facility, setFacility] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [openPid, setOpenPid] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => get(),
  });

  const detailQ = useQuery({
    enabled: !!openPid,
    queryKey: ["patient", openPid],
    queryFn: () => detail({ data: { patient_id: openPid! } }),
  });

  const filtered = rows.filter(
    (r) => (!facility || r.facility === facility) && (!decision || r.decision === decision),
  );

  const counts = {
    auto_accept: rows.filter((r) => r.decision === "auto_accept").length,
    flag_for_review: rows.filter((r) => r.decision === "flag_for_review").length,
    reject: rows.filter((r) => r.decision === "reject").length,
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4">
          <div className="flex items-baseline gap-6">
            <h1 className="text-xl font-semibold">Wellator</h1>
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Dashboard
            </Link>
            <Link to="/runs" className="text-sm text-muted-foreground hover:text-foreground">
              Pipeline runs
            </Link>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard label="Auto-accept" value={counts.auto_accept} tone="green" />
          <StatCard label="Flag for review" value={counts.flag_for_review} tone="amber" />
          <StatCard label="Reject" value={counts.reject} tone="red" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Facility:</span>
          {[null, "A", "B", "C"].map((f) => (
            <Button
              key={String(f)}
              variant={facility === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFacility(f)}
            >
              {f ?? "All"}
            </Button>
          ))}
          <span className="ml-4 text-sm text-muted-foreground">Decision:</span>
          {[null, "auto_accept", "flag_for_review", "reject"].map((d) => (
            <Button
              key={String(d)}
              variant={decision === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDecision(d)}
            >
              {d ? d.replace(/_/g, " ") : "All"}
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isLoading ? "Loading..." : `${filtered.length} patients`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 && !isLoading ? (
              <p className="text-sm text-muted-foreground">
                No eligibility decisions yet. Go to{" "}
                <Link to="/runs" className="underline">
                  Pipeline runs
                </Link>{" "}
                to ingest, extract, and decide.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Routing reason</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.patient_id}>
                      <TableCell className="font-mono text-xs">{r.patient_id}</TableCell>
                      <TableCell>{r.facility}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={DECISION_COLORS[r.decision] ?? ""}>
                          {r.decision.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{r.routing_reason}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenPid(openPid === r.patient_id ? null : r.patient_id)}
                        >
                          {openPid === r.patient_id ? "Close" : "Open"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {openPid && detailQ.data && (
          <PatientDrillDown data={detailQ.data} />
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" }) {
  const cls = {
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  }[tone];
  return (
    <Card className={cls}>
      <CardContent className="p-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-4xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function PatientDrillDown({ data }: { data: any }) {
  const elig = data.eligibility;
  const primaryId = elig?.primary_extraction_id;
  const primary = data.extractions.find((e: any) => e.id === primaryId) ?? data.extractions[0];
  const sourceNote = data.notes.find((n: any) => n.id === primary?.source_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Patient {elig?.patient_id}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Source note
          </h3>
          <div className="rounded border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            {sourceNote?.body ?? "(no source note found)"}
          </div>
          {primary?.source_quote && (
            <div className="mt-3 rounded border-l-4 border-primary bg-primary/5 p-3 text-sm italic">
              "{primary.source_quote}"
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Extracted
          </h3>
          <dl className="space-y-1 text-sm">
            <Row k="Wound type" v={primary?.wound_type} />
            <Row k="Stage" v={primary?.wound_stage} />
            <Row k="Location" v={primary?.location} />
            <Row
              k="Measurements"
              v={
                primary
                  ? `${primary.length_cm ?? "?"} × ${primary.width_cm ?? "?"} × ${primary.depth_cm ?? "?"} cm`
                  : null
              }
            />
            <Row k="Drainage" v={primary?.drainage} />
            <Row k="Confidence" v={primary?.confidence} />
            <Row k="Has Part B" v={String(elig?.has_partb)} />
            <Row k="Missing" v={elig?.missing_fields?.join(", ") || "—"} />
          </dl>
          <div className="mt-3 rounded bg-muted/30 p-3 text-sm">
            <span className="font-semibold">Routing reason: </span>
            {elig?.routing_reason}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-xs">{v ?? "—"}</dd>
    </div>
  );
}
