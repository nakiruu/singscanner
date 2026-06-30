import Link from "next/link";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function register(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const username = String(formData.get("username") ?? "").trim();

    // Username rules: 3-30 chars, letters / digits / underscore / hyphen.
    // Tight enough to avoid clashes with URL paths and weird display.
    const usernameOk = /^[A-Za-z0-9_-]{3,30}$/.test(username);
    if (!email || password.length < 8 || !usernameOk) {
      redirect("/register?error=invalid");
    }

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) redirect("/register?error=email-exists");

    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) redirect("/register?error=username-exists");

    // ADMIN_EMAILS bootstrap: anyone registering with a listed email is
    // promoted to ADMIN on creation. Comma-separated, case-insensitive.
    const adminList = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const role = adminList.includes(email) ? "ADMIN" : "USER";

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        username,
        // Default the display name to the username so Auth.js session.user.name
        // shows something sensible until the user sets a real name in settings.
        name: username,
        passwordHash,
        role,
        settings: { create: {} },
      },
    });

    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={register} className="space-y-3">
          <Field name="username" type="text" placeholder="3-30 chars, a-z 0-9 _ -" label="Username" />
          <Field name="email" type="email" placeholder="you@example.com" label="Email" />
          <Field name="password" type="password" placeholder="8+ characters" label="Password" />
          {error && (
            <p className="font-mono text-xs text-error">
              {error === "email-exists"
                ? "An account with that email already exists."
                : error === "username-exists"
                ? "That username is taken."
                : "Please check your inputs."}
            </p>
          )}
          <Button type="submit" className="w-full">
            Register
          </Button>
        </form>
        <p className="mt-4 text-center font-mono text-xs text-on-surface-variant">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
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
  required = true,
}: {
  name: string;
  type: string;
  placeholder: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="label-caps">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="block w-full rounded border border-border bg-surface-lowest px-3 py-2 font-mono text-sm text-on-surface placeholder:text-terminal-gray focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}
