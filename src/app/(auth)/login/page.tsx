import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, googleEnabled } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Map raw Auth.js AuthError types to user-facing strings.
// Handles credential and OAuth failure modes so the UI never shows a generic
// "Sign-in failed." for the common cases.
function friendlyError(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "CredentialsSignin":
      return "Invalid email or password.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
    case "Callback":
      return "Google sign-in failed. Please try again.";
    case "OAuthAccountNotLinked":
      return "This email is already registered with a password. Sign in with your password instead.";
    case "AccessDenied":
      return "Access denied.";
    case "Verification":
      return "The sign-in link is invalid or has expired.";
    case "Configuration":
      return "Sign-in is misconfigured. Contact an admin.";
    case "post-register":
      return "Account created. Please sign in.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/dashboard", error } = await searchParams;
  const errorMsg = friendlyError(error);

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

  async function loginWithGoogle(formData: FormData) {
    "use server";
    const redirectTo = String(formData.get("from") ?? "/dashboard");
    try {
      await signIn("google", { redirectTo });
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
          {errorMsg && (
            <p className="font-mono text-xs text-error" role="alert">
              {errorMsg}
            </p>
          )}
          <Button type="submit" className="w-full">
            Sign In
          </Button>
        </form>

        {googleEnabled && (
          <>
            <Divider>or</Divider>
            <form action={loginWithGoogle}>
              <input type="hidden" name="from" value={from} />
              <Button type="submit" variant="ghost" className="w-full">
                <GoogleIcon />
                Continue with Google
              </Button>
            </form>
          </>
        )}

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

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function GoogleIcon() {
  // Simple monochrome G — the visible Google mark. Kept inline so the login
  // page has no runtime dependency on an SVG asset.
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 10.2v3.9h5.5c-.24 1.42-1.7 4.16-5.5 4.16-3.31 0-6-2.74-6-6.11s2.69-6.11 6-6.11c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.85 3.4 14.6 2.5 12 2.5 6.75 2.5 2.5 6.75 2.5 12S6.75 21.5 12 21.5c6.93 0 9.5-4.86 9.5-9.34 0-.63-.07-1.11-.16-1.61H12z" />
    </svg>
  );
}
