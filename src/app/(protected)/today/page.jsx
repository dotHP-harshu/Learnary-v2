import TodayPage from "../../../components/today/TodayPage";

export const metadata = {
  title: "Today",
};

// Route entry for /today — the authenticated landing page.
export default function Today() {
  return <TodayPage />;
}
