import React from "react";
import { createRoot } from "react-dom/client";
import App from "~/components/App";
import { AppContextProvider } from "~/AppContext";
import "~/styles";
import "~/i18n";

const root = createRoot(document.getElementById("root"));
root.render(
  <AppContextProvider>
    <App />
  </AppContextProvider>
);
