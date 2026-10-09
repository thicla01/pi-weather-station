import React from "react";
import { createRoot } from "react-dom/client";
import App from "~/components/App";
import { AppContextProvider } from "~/AppContext";
import "~/styles";
import "~/i18n";

// Browser hint for CSS-level performance opt-outs: Firefox drops the
// backdrop blur of the overlays above the radar map (see
// styles/main.css). A data attribute on <html>, set before the first
// render, rather than a class managed by React: it applies before the
// first paint and never re-renders anything. Technique ported from the
// Sweep fork (github.com/Aryeh95, commit c0e2ed4).
if (/firefox/i.test(navigator.userAgent)) {
  document.documentElement.setAttribute("data-browser", "firefox");
}

const root = createRoot(document.getElementById("root"));
root.render(
  <AppContextProvider>
    <App />
  </AppContextProvider>
);
