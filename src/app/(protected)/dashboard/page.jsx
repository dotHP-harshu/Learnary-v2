import { redirect } from "next/navigation";

// /dashboard was merged into /today; this page keeps existing links,
// bookmarks and manifest entries working while the redirect resolves.
export default function DashboardPage() {
  redirect("/today");
}
