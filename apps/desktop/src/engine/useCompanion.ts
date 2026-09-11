import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, Companion, Snapshot } from "./port";

function message(error: unknown): string {
  if (error === "update-required")
    return "Update required. Campaign changes are disabled until the Companion and server versions match.";
  if (error === "not-available")
    return "This action is not available in the foundation build. No files were changed.";
  return "Could not communicate with the Companion engine. Please reopen the application.";
}

export function useCompanion(companion: Companion) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const session = useRef<{ companion: Companion; revision: number } | null>(
    null,
  );

  const accept = useCallback(
    (next: Snapshot) => {
      if (
        session.current?.companion === companion &&
        next.revision > session.current.revision
      ) {
        session.current.revision = next.revision;
        setSnapshot(next);
      }
    },
    [companion],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    session.current = { companion, revision: -1 };
    setSnapshot(null);
    setError(null);
    setPending(false);
    // Listen first. A concurrent event may arrive before the snapshot response;
    // revision gating means that older response cannot roll the UI back.
    void companion
      .subscribe((next) => {
        if (active) accept(next);
      })
      .then(async (stop) => {
        if (!active) {
          stop();
          return;
        }
        unsubscribe = stop;
        const initial = await companion.snapshot();
        if (active) accept(initial);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      });
    return () => {
      active = false;
      session.current = null;
      unsubscribe?.();
    };
  }, [companion, accept]);

  const send = async (command: Command) => {
    const requestSession = session.current;
    setPending(true);
    setError(null);
    try {
      const next = await companion.command(command);
      if (session.current === requestSession) accept(next);
    } catch (cause) {
      if (session.current === requestSession) setError(message(cause));
    } finally {
      if (session.current === requestSession) setPending(false);
    }
  };

  return { snapshot, error, pending, send, dismissError: () => setError(null) };
}
