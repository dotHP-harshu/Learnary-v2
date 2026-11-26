"use client";

import React, { useContext, useEffect, useState } from "react";
import { installPromtContext } from "../../context/InstallAppContext";
import { Download, X } from "lucide-react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";

/**
 * PWA install prompt (redesign): a small dismissible card instead of the
 * bouncing-arrow stack. Hidden while running in standalone mode.
 */
function InstallApp() {
  const { deferredPrompt, setDeferredPrompt } = useContext(installPromtContext);
  const [showButton, setShowButton] = useState(false);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setShowButton(false);
    }
  };

  useEffect(() => {
    const isInStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (isInStandaloneMode) {
      setShowButton(false);
    } else if (deferredPrompt) {
      setShowButton(true);
    }
  }, [deferredPrompt]);

  if (!showButton) return null;

  return (
    <div
      role="region"
      aria-label="Install Learnary"
      className="fixed bottom-20 right-4 z-30 flex max-w-xs items-start gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-lg lg:bottom-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
        <Download size={18} className="text-accent" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">Install Learnary</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Add it to your device for offline access.
        </p>
        <Button size="sm" className="mt-2" onClick={handleInstall}>
          Install
        </Button>
      </div>
      <IconButton
        label="Dismiss install prompt"
        variant="ghost"
        size="sm"
        className="-mr-1 -mt-1"
        onClick={() => setShowButton(false)}
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}

export default InstallApp;
