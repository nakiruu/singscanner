import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/dashboard", error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const redirectTo = String(formData.get("from") ?? "/dashboard");
    try {
      await signIn("credentials", { email, password, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/login?error=${err.type}&from=${redirectTo}`);
      }
      throw err;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={login} className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <Field name="email" type="email" placeholder="you@example.com" label="Email" />
          <Field name="password" type="password" placeholder="••••••••" label="Password" />
          {error && (
            <p className="font-mono text-xs text-error">
              {error === "CredentialsSignin" ? "Invalid credentials." : "Sign-in failed."}
            </p>
          )}
          <Button type="submit" className="w-full">
            Sign In
          </Button>
        </form>
        <p className="mt-4 text-center font-mono text-xs text-on-surface-variant">
          No account?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Register
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  name,
  type,
  placeholder,
  label,
}: {
  name: string;
  type: string;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="label-caps">{label}</span>
      <input
        name={name}
        type={type}
        required
        placeholder={placeholder}
        className="block w-full rounded border border-border bg-surface-lowest px-3 py-2 font-mono text-sm text-on-surface placeholder:text-terminal-gray focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}
