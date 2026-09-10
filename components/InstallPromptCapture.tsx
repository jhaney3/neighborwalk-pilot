"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "../lib/install";

export function InstallPromptCapture() {
  useEffect(() => {
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);
  return null;
}
