import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopShell } from "@/feature/x-workspace/components/desktop-shell.js";
import "@/feature/x-workspace/styles/workspace.css";

document.documentElement.classList.add("light");

const container = document.getElementById("root");
if (!container) {
  throw new Error("Desktop renderer root element was not found.");
}

createRoot(container).render(
  <StrictMode>
    <DesktopShell />
  </StrictMode>
);
