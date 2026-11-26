import Loading from "../../components/ui/Loading";

// Segment-level fallback for authenticated route transitions: the shared app
// shell renders instantly while the destination page's client bundle and
// effects resolve.
export default function ProtectedLoading() {
  return (
    <div className="min-h-[50dvh] w-full">
      <Loading />
    </div>
  );
}
