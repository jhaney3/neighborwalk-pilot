import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { NeighborWalkRoot } from "../components/SupabaseGate";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { AppCrashed } from "../components/EntryScreens";
import { installNavigation, navigate, usePathname } from "./navigation";
import { receiveAuthLink } from "./auth-links";
import { publishNativeConnectivity } from "./connectivity";
import { installMobileFocusModality, installSingleLineKeyboardDismissal } from "./keyboard";
import { installMobileColorTheme } from "./theme";
import { installPressHaptics } from "./haptics";
import { addDeviceReminderTapListener } from "./notifications";
import { addRemotePushTapListener, REMOTE_PUSH_REFRESH_EVENT } from "./push-notifications";
import "maplibre-gl/dist/maplibre-gl.css";
import "../app/styles/foundation.css";
import "../app/styles/primitives.css";
import "../app/styles/map.css";
import "../app/styles/property.css";
import "../app/styles/views.css";
import "../app/styles/people.css";
import "../app/styles/guides.css";
import "../app/styles/administration.css";
import "../app/styles/overlays.css";
import "../app/styles/auth.css";
import "../app/styles/responsive.css";
import "../app/styles/controls.css";
import "../app/styles/guide-polish.css";
import "../app/styles/address-list.css";
import "../app/styles/today.css";
import "../app/styles/walk-detail.css";
import "../app/styles/data-health.css";
import "../app/styles/sync.css";
import "../app/styles/screens-responsive.css";
import "../app/styles/print.css";
import "../app/styles/walk-lists.css";
import "../app/styles/home.css";
import "../app/styles/shell.css";
import "../app/styles/conversations.css";
import "../app/styles/walk-setup.css";
import "../app/styles/walk-target-planner.css";
import "../app/styles/walk-mode.css";
import "../app/styles/followups.css";
import "../app/styles/walk-page.css";
import "../app/styles/pins.css";
import "../app/styles/entry.css";
import "./native.css";

installMobileColorTheme();
installNavigation();
installMobileFocusModality();
installSingleLineKeyboardDismissal();
if (Capacitor.isNativePlatform()) {
  const printer = registerPlugin<{ print(): Promise<{ completed: boolean }> }>("NeighborWalkPrint");
  window.print = () => { void printer.print().catch(() => window.alert("The worksheet could not be printed. Please try again.")); };
  void App.addListener("appUrlOpen", ({ url }) => receiveAuthLink(url));
  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event(REMOTE_PUSH_REFRESH_EVENT));
  });
  void App.getLaunchUrl().then((result) => { if (result) receiveAuthLink(result.url); });
  void Network.getStatus().then(({ connected }) => publishNativeConnectivity(connected)).catch(() => {});
  void Network.addListener("networkStatusChange", ({ connected }) => publishNativeConnectivity(connected));
  void addDeviceReminderTapListener((target) => navigate(target));
  void addRemotePushTapListener((target) => navigate(target));
  installPressHaptics();
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <AppCrashed /> : this.props.children;
  }
}
function MobileApp() {
  const path = usePathname();
  return <AppBoundary>{path === "/demo" ? <NeighborWalkApp /> : <NeighborWalkRoot />}</AppBoundary>;
}
createRoot(document.getElementById("root")!).render(<MobileApp />);
