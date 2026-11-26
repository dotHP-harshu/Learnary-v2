import ProgressPage from "../../../components/progress/ProgressPage";

// Server route entry (the protected layout supplies AppShell) — the page is
// rendered by the client component below it.
export const metadata = {
  title: "Progress",
};

/** Route entry for /progress (the protected layout supplies AppShell). */
export default function Progress() {
  return <ProgressPage />;
}
