import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const FILES = [
  "patients.csv",
  "coverage.csv",
  "diagnoses.csv",
  "clinical_notes.csv",
  "assessments.csv",
  "wound_extractions.csv",
  "eligibility_results.csv",
  "failed_api_calls.csv",
];

export const Route = createFileRoute("/_authenticated/reference-data")({
  head: () => ({ meta: [{ title: "Reference Data" }] }),
  component: ReferenceData,
});

function ReferenceData() {
  const [selected, setSelected] = useState<string>(FILES[0]);
  const [text, setText] = useState<string>("");
  const [rows, setRows] = useState<string[][]>([]);

  useEffect(() => {
    fetch(`/data/${selected}`)
      .then((r) => r.text())
      .then((t) => {
        setText(t);
        const lines = t.split(/\r?\n/).slice(0, 200);
        setRows(lines.map((l) => l.split(",")));
      });
  }, [selected]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Reference Data</h1>
      <div className="flex flex-wrap gap-2">
        {FILES.map((f) => (
          <Button
            key={f}
            variant={f === selected ? "default" : "outline"}
            size="sm"
            onClick={() => setSelected(f)}
          >
            {f}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{selected}</CardTitle>
          <a href={`/data/${selected}`} download>
            <Button size="sm" variant="outline">Download</Button>
          </a>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-2">
            {text.split("\n").length.toLocaleString()} lines · showing first 200
          </div>
          <div className="overflow-auto max-h-[60vh] border rounded">
            <table className="text-xs w-full">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={i === 0 ? "bg-muted font-semibold" : ""}>
                    {r.map((c, j) => (
                      <td key={j} className="border px-2 py-1 align-top whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
