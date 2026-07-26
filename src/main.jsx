import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Theme the native status bar to match the app so there's no mismatched
// gray/white system bar sitting on top of the dark UI. No-ops safely on web.
(async () => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setBackgroundColor({ color: "#14110F" });
    await StatusBar.setStyle({ style: Style.Light }); // light icons for a dark background
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // @capacitor/status-bar not installed on this platform build — ignore.
  }
})();
