import { redirect } from "next/navigation";

// /alerts is discoverable from the topbar bell + command palette, but the
// canonical alert configuration lives in /settings/notifications. Route
// exists as a redirect so we don't have to teach users a second location.
export default function AlertsIndex() {
  redirect("/settings/notifications");
}
