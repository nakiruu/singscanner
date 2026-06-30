import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PortfolioPage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-sans text-2xl font-semibold">Portfolio</h1>
        <Button size="sm">Add position</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-terminal-gray">
            No positions yet. Add one to overlay stop / target / decision on live scans.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
