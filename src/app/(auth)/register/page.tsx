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
    const name = String(formData.get("name") ?? "").trim() || null;

    if (!email || password.length < 8) {
      redirect("/register?error=invalid");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      redirect("/register?error=exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
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
          <Field name="name" type="text" placeholder="Optional" label="Name" required={false} />
          <Field name="email" type="email" placeholder="you@example.com" label="Email" />
          <Field name="password" type="password" placeholder="8+ characters" label="Password" />
          {error && (
            <p className="font-mono text-xs text-error">
              {error === "exists"
                ? "An account with that email already exists."
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
