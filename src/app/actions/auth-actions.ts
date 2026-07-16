"use server";

// Server actions for auth. Kept as a colocated module so the UserMenu
// client component can import them without dragging next-auth internals
// into the client bundle.

import { signOut } from "@/auth";

// Log the current user out and land them back on the login page.
// Called from a <form action={signOutAction}> in UserMenu.
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
