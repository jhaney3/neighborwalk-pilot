export const NATIVE_CONNECTIVITY_EVENT = "neighborwalk-native-connectivity";

let nativeConnected: boolean | undefined;

/** Capacitor's Network plugin is authoritative in the native shell. WKWebView's
 * navigator.onLine can lag behind the plugin callback, so retain the reported
 * value instead of translating it into a generic event and reading it back. */
export function publishNativeConnectivity(connected: boolean, target: EventTarget = window) {
  nativeConnected = connected;
  target.dispatchEvent(new CustomEvent(NATIVE_CONNECTIVITY_EVENT, { detail: { connected } }));
}

export function effectiveConnectivity(browserConnected: boolean) {
  return nativeConnected ?? browserConnected;
}

export function resetNativeConnectivityForTests() {
  nativeConnected = undefined;
}
