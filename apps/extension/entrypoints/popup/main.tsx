import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import Popup from "./popup.tsx";

import "./style.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Popup root element was not found.");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
