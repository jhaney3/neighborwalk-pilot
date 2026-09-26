import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

// Used sparingly and the same way everywhere: a light tap when a pin drops, a
// success when a visit saves, and a tick when a segment or chip changes.
const native = () => Capacitor.isNativePlatform();

export function pinDropped() {
  if (native()) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function visitSaved() {
  if (native()) void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function selectionTick() {
  if (native()) void Haptics.selectionChanged().catch(() => {});
}
