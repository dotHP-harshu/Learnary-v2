import ProtectRoute from "../../components/auth/ProtectRoute";
import AppShell from "../../components/layout/AppShell";
import OnboardingGate from "../../components/onboarding/OnboardingGate";

// Wraps every authenticated route with the shared auth guard, the shared app
// shell (top bar + primary navigation), and the one-time skippable onboarding gate.
export default function ProtectedLayout({ children }) {
  return (
    <ProtectRoute>
      <AppShell>
        <OnboardingGate>{children}</OnboardingGate>
      </AppShell>
    </ProtectRoute>
  );
}
