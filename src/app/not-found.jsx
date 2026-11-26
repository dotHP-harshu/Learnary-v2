import Link from "next/link";
import { Compass } from "lucide-react";
import Button from "../components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
        <Compass size={22} className="text-accent" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold text-fg">Page not found</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Button as={Link} href="/collection">
        Go to your collections
      </Button>
    </div>
  );
}
