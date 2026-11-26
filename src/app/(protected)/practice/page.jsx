import PracticePage from "../../../components/practice/PracticePage";

// Server route entry (the protected layout supplies AppShell) — the page is
// rendered by the client component below it.
export const metadata = {
  title: "Practice",
};

/** Route entry for /practice (the protected layout supplies AppShell). */
export default function Practice() {
  return <PracticePage />;
}
