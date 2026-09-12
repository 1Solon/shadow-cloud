import { useEffect, useState } from "react";
import type { OnboardingStage } from "../engine/port";
import { ConnectSystemDiagram } from "./ConnectSystemDiagram";

export function ConnectGraphic({
  stage,
  connected,
}: {
  stage: OnboardingStage;
  connected: boolean;
}) {
  const [suspended, setSuspended] = useState(false);
  const visible = stage === "sign-in";

  useEffect(() => {
    if (!visible) return;
    const visibilityChanged = () => setSuspended(document.hidden);
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      className="connect-graphic"
      aria-hidden="true"
      data-powered={connected}
      data-suspended={suspended}
    >
      <ConnectSystemDiagram connected={connected} />
    </div>
  );
}
