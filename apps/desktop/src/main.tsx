import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { nativeCompanion } from "./engine/native";
import type { Companion } from "./engine/port";
import { App } from "./ui/App";
import "./styles.css";

async function start() {
  let companion: Companion = nativeCompanion;
  let development = false;
  // Vite removes this entire branch and its dynamic import in production.
  if (import.meta.env.DEV) {
    const scenario = new URLSearchParams(location.search).get("scenario");
    if (scenario) {
      const { createDevelopmentCompanion } =
        await import("./development/companion");
      companion = createDevelopmentCompanion(scenario);
      development = true;
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App companion={companion} development={development} />
    </StrictMode>,
  );
}
void start();
