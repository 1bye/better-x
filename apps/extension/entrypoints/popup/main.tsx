import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { FocusModePopup } from "../../feature/focus-mode/components/focus-mode-popup";

import "./style.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Popup root element was not found.");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <FocusModePopup />
  </StrictMode>
);
