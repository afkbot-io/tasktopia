import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerTasktopiaServiceWorker } from "./pwa";
import "./styles.css";

document.documentElement.dataset.appVersion = __TASKTOPIA_VERSION__;
registerTasktopiaServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
