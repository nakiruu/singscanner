import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PipelinePage() {
  return (
    <div className="space-y-6 p-6">
      <h1 className="font-sans text-2xl font-semibold">Pipeline</h1>
      <Card>
        <CardHeader>
          <CardTitle>Reference</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-invert max-w-none font-mono text-xs text-on-surface-variant">
          <p>
            Full engine spec lives in <code>docs/instructions2.md</code>. Signal families,
            after-cost gate, and sell triggers are ported in <code>src/lib/engine</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
