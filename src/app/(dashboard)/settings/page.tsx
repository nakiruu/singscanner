import { redirect } from "next/navigation";

// Bare /settings redirects to the default Profile tab. All settings content
// lives under /settings/{profile,account,notifications,brokerage,billing,api-keys}.
export default function SettingsIndex() {
  redirect("/settings/profile");
}
