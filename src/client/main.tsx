import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerTasktopiaServiceWorker } from "./pwa";
import "./styles.css";

document.documentElement.dataset.appVersion = __TASKTOPIA_VERSION__;
registerTasktopiaServiceWorker();

const blockWorldPreview = import.meta.env.VITE_BLOCK_WORLD_PREVIEW === "1"
  && new URLSearchParams(window.location.search).get("block-preview") === "1";
const root = createRoot(document.getElementById("root")!);

if (blockWorldPreview) {
  void import("./components/BlockWorldPreview").then(({ BlockWorldPreview }) => {
    root.render(<StrictMode><BlockWorldPreview /></StrictMode>);
  });
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
