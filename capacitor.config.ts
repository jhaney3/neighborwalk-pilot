import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.neighborwalk.ios",
  appName: "NeighborWalk",
  webDir: "mobile/dist",
  // No server.url: all application code ships in the reviewed binary.
  ios: { contentInset: "never", backgroundColor: "#f5f6f3", preferredContentMode: "mobile", zoomEnabled: true },
  plugins: {
    Keyboard: { resize: "body", resizeOnFullScreen: true },
    CapacitorHttp: { enabled: true },
  },
};
export default config;
