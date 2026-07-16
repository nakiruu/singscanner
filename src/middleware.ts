import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Anything not in PUBLIC requires authentication.
// Anything in PREMIUM_GATED additionally requires PREMIUM or ADMIN role.
// /admin requires ADMIN role.
const PUBLIC_EXACT = new Set(["/", "/login", "/register"]);
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon", "/public"];

const PREMIUM_GATED_PREFIXES = ["/dashboard", "/portfolio", "/pipeline"];
const ADMIN_GATED_PREFIXES = ["/admin"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // Auth gate first.
  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  const role = req.auth.user?.role ?? "USER";

  // Admin gate.
  if (matchesPrefix(pathname, ADMIN_GATED_PREFIXES) && role !== "ADMIN") {
    // Rejected admins land on the dashboard — they're still authenticated
    // and the dashboard is their appropriate context. The old /upgrade
    // page was absorbed into /settings/billing.
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Premium gate.
  if (matchesPrefix(pathname, PREMIUM_GATED_PREFIXES) && role !== "PREMIUM" && role !== "ADMIN") {
    const url = req.nextUrl.clone();
    url.pathname = "/settings/billing";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
