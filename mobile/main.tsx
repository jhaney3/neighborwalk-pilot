import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Haptics } from "@capacitor/haptics";
import { Network } from "@capacitor/network";
import { NeighborWalkRoot } from "../components/SupabaseGate";
import { NeighborWalkApp } from "../app/NeighborWalkApp";
import { installNavigation, navigate, usePathname } from "./navigation";
import { receiveAuthLink } from "./auth-links";
import { publishNativeConnectivity } from "./connectivity";
import { installMobileFocusModality, installSingleLineKeyboardDismissal } from "./keyboard";
import { installMobileColorTheme } from "./theme";
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
import "../app/styles/readiness.css";
import "../app/styles/home.css";
import "../app/styles/walk-setup.css";
import "../app/styles/walk-target-planner.css";
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
  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".mobile-nav button:not(.active)")) void Haptics.selectionChanged().catch(() => {});
  });
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="app-loading"><h1>Let’s reopen your workspace.</h1><p>Your saved work is still on this device.</p><button className="button primary" onClick={() => window.location.reload()}>Try again</button></main> : this.props.children;
  }
}
function MobileApp() {
  const path = usePathname();
  return <AppBoundary>{path === "/demo" ? <NeighborWalkApp /> : <NeighborWalkRoot />}</AppBoundary>;
}
createRoot(document.getElementById("root")!).render(<MobileApp />);
