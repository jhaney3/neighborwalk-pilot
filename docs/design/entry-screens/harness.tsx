// Capture-only fixture for capture.mjs; never imported by either application.
// Renders one entry screen that no flow reaches on demand, chosen by
// window.__entryState, over the running app.
import { createRoot } from "react-dom/client";
import { AppFailure, AppLoading } from "../../../app/NeighborWalkApp";
import { AppCrashed } from "../../../components/EntryScreens";
import { ConnectionProblem, OfflineWorkspace, PasswordRecovery, WorkspaceUnavailable } from "../../../components/SupabaseGate";
import { ConfirmProvider } from "../../../components/ui";

const screens: Record<string, React.ReactNode> = {
  recovery: <PasswordRecovery email="dee@example.test" onSave={async () => {}} />,
  loading: <AppLoading />,
  failure: <AppFailure error="Your church’s records couldn’t be loaded from this phone." onSignOut={async () => {}} onRecovery={async () => {}} />,
  connection: <ConnectionProblem error="Sign-in could not be checked. Reconnect and try again. Your device records have not been cleared." />,
  offline: <OfflineWorkspace onOpen={() => {}} />,
  crash: <AppCrashed />,
  unavailable: <WorkspaceUnavailable />,
};
const state = (window as unknown as { __entryState?: string }).__entryState ?? "loading";
// Keep the app's #root styling (full-bleed, safe areas) on the fixture's host.
const app = document.getElementById("root")!;
app.id = "app-under-fixture";
app.hidden = true;
const host = document.createElement("div");
host.id = "root";
document.body.append(host);
createRoot(host).render(<ConfirmProvider>{screens[state]}</ConfirmProvider>);
