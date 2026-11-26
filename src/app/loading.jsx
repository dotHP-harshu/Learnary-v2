import Loading from "../components/ui/Loading";

// Root-level fallback for navigation into segments without their own
// loading boundary.
export default function RootLoading() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-bg">
      <Loading />
    </div>
  );
}
