import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

// One vocabulary, used the same way everywhere:
// - tick: every button press, field tap, chip and segment change
// - light tap: a pin or a drawing corner lands on the map
// - success / warning / error: a save lands, a destructive confirmation opens,
//   an action fails
// A tick right after another haptic is dropped, so a button that already gave
// its own feedback doesn't buzz twice. The same outcome twice in a row (an
// explicit success and then the "Saved" toast) plays once.
const native = () => Capacitor.isNativePlatform();
let lastAt = 0;
let lastOutcome: { type: NotificationType; at: number } | null = null;

function play(effect: () => Promise<void>) {
  lastAt = Date.now();
  void effect().catch(() => {});
}

function outcome(type: NotificationType) {
  if (!native()) return;
  const now = Date.now();
  if (lastOutcome?.type === type && now - lastOutcome.at < 600) return;
  lastOutcome = { type, at: now };
  play(() => Haptics.notification({ type }));
}

export function selectionTick() {
  if (native() && Date.now() - lastAt > 80) play(() => Haptics.selectionChanged());
}

export function pinDropped() {
  if (native()) play(() => Haptics.impact({ style: ImpactStyle.Light }));
}

export const cornerPlaced = pinDropped;

export const saveSucceeded = () => outcome(NotificationType.Success);
export const destructiveAsked = () => outcome(NotificationType.Warning);
export const actionFailed = () => outcome(NotificationType.Error);

const PRESSABLE = "button, a[href], summary, [role=button], [role=switch], [role=checkbox], [role=radio], [role=tab], input[type=checkbox], input[type=radio]";
const TYPEABLE = "textarea, select, [contenteditable=true], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=color]):not([type=file]):not([type=hidden])";

/** A tick for every button press and every tap into a text field. Focus that
 * code moves on its own (a sheet focusing its first field) stays silent. */
export function installPressHaptics() {
  let touched: Element | null = null;
  let touchedAt = 0;
  document.addEventListener("pointerdown", (event) => { touched = event.target as Element; touchedAt = Date.now(); }, true);
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest?.(PRESSABLE) && !target.closest(TYPEABLE)) selectionTick();
  });
  document.addEventListener("focusin", (event) => {
    const field = (event.target as Element).closest?.(TYPEABLE);
    if (!field || !touched || Date.now() - touchedAt > 800) return;
    const label = touched.closest("label");
    if (field.contains(touched) || label?.control === field || label?.contains(field)) selectionTick();
  });
}
