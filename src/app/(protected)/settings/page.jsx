import { redirect } from "next/navigation";

// Settings was merged into My Profile; this page keeps existing links and
// bookmarks working while the redirect resolves.
export default function SettingsPage() {
  redirect("/profile");
}
