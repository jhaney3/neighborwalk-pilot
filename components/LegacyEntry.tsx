"use client";
import { useEffect } from "react";
import { legacyAppPath } from "../lib/auth-navigation";
export function LegacyEntry() {
  useEffect(() => {
    const target = legacyAppPath(window.location.search, window.location.hash, window.matchMedia("(display-mode: standalone)").matches);
    if (target) window.location.replace(target);
  }, []);
  return null;
}
