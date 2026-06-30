import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <h1 className="font-sans text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Scanner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-sm">
          <div className="flex justify-between">
            <span className="text-on-surface-variant">Horizon</span>
            <span className="text-primary">3D</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-variant">Universe</span>
            <span className="text-primary">AUTO</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-variant">Max symbols</span>
            <span className="text-primary">300</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Alpaca</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-terminal-gray">
            Set ALPACA_API_KEY / SECRET in .env. UI for per-user keys lands with auth.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
