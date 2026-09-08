"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  isPasswordReceipt,
  isPasswordRecovery,
  isSaveInspection,
  type PasswordReceipt,
  type PasswordRecovery,
  type SaveInspection,
} from "@/lib/save-inspection";

export type PasswordWorkflowIdentity = {
  campaignId: string;
  gameNumber: number;
  canManagePasswords: boolean;
  hasSave: boolean;
  saveRevision?: string;
};
type State = {
  inspection: SaveInspection | null;
  recovery: PasswordRecovery | null;
  inspecting: boolean;
  recovering: boolean;
  inspectionError: string | null;
  recoveryError: string | null;
  selected: string | null;
  pending: "reset" | "undo" | null;
  outcome: { kind: "unknown" } | { kind: "rejected"; message: string } | null;
  success: (PasswordReceipt & { action: "reset" | "undo" }) | null;
};
const empty: State = {
  inspection: null,
  recovery: null,
  inspecting: false,
  recovering: false,
  inspectionError: null,
  recoveryError: null,
  selected: null,
  pending: null,
  outcome: null,
  success: null,
};
const unknownOutcome =
  "Outcome unknown. The request could not be confirmed. No operation will be replayed. Checking the latest save and recovery separately; review the fresh state and explicitly confirm before trying another action. Recovery availability is not proof that this attempt succeeded.";

export function useSavePasswordWorkflow(identity: PasswordWorkflowIdentity) {
  const router = useRouter();
  const identityKey = JSON.stringify([
    identity.campaignId,
    identity.gameNumber,
    identity.canManagePasswords,
    identity.hasSave,
    identity.saveRevision,
  ]);
  const current = useRef(identityKey);
  const mounted = useRef(false);
  const inspectionRequest = useRef<AbortController | null>(null);
  const recoveryRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const [stored, setStored] = useState({ identityKey, identity, state: empty });
  let state = stored.state;
  if (stored.identityKey !== identityKey) {
    const success = state.success;
    const sameCampaign = stored.identity.campaignId === identity.campaignId;
    state = {
      ...empty,
      outcome:
        sameCampaign && state.outcome?.kind === "unknown"
          ? state.outcome
          : null,
      success:
        sameCampaign &&
        identity.canManagePasswords &&
        identity.hasSave &&
        success &&
        identity.saveRevision ===
          `${success.fileVersionId}:${success.contentRevision}`
          ? success
          : null,
    };
    setStored({ identityKey, identity, state });
  }
  const update = (change: Partial<State>) => {
    if (!mounted.current || current.current !== identityKey) return;
    setStored((previous) =>
      previous.identityKey === identityKey
        ? { ...previous, state: { ...previous.state, ...change } }
        : previous,
    );
  };
  const active = (controller: AbortController) =>
    mounted.current &&
    current.current === identityKey &&
    !controller.signal.aborted;
  const base = `/api/games/${encodeURIComponent(String(identity.gameNumber))}`;

  async function inspect() {
    if (!identity.canManagePasswords || !identity.hasSave || mutation.current)
      return;
    inspectionRequest.current?.abort();
    const controller = new AbortController();
    inspectionRequest.current = controller;
    update({
      inspection: null,
      selected: null,
      inspecting: true,
      inspectionError: null,
    });
    try {
      const response = await fetch(`${base}/save-inspection`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!active(controller)) return;
      const payload: unknown = await response.json();
      if (!active(controller)) return;
      if (!response.ok || !isSaveInspection(payload)) {
        update({
          inspectionError: response.ok
            ? "Save inspection is invalid. Retry inspection."
            : errorMessage(
                payload,
                "Save inspection failed. Retry inspection.",
              ),
        });
        return;
      }
      setStored((previous) => {
        if (previous.identityKey !== identityKey) return previous;
        const success = previous.state.success;
        return {
          ...previous,
          state: {
            ...previous.state,
            inspection: payload,
            success:
              success?.fileVersionId === payload.fileVersionId &&
              success.contentRevision === payload.contentRevision
                ? success
                : null,
          },
        };
      });
    } catch {
      if (active(controller))
        update({
          inspectionError:
            "The save inspection request failed. Retry inspection.",
        });
    } finally {
      if (active(controller)) update({ inspecting: false });
      if (inspectionRequest.current === controller)
        inspectionRequest.current = null;
    }
  }

  async function readRecovery() {
    if (!identity.canManagePasswords || !identity.hasSave || mutation.current)
      return;
    recoveryRequest.current?.abort();
    const controller = new AbortController();
    recoveryRequest.current = controller;
    update({ recovery: null, recovering: true, recoveryError: null });
    try {
      const response = await fetch(`${base}/password-reset`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!active(controller)) return;
      const payload: unknown = await response.json();
      if (!active(controller)) return;
      if (!response.ok || !isPasswordRecovery(payload)) {
        update({ recoveryError: "Recovery is unavailable. Retry recovery." });
        return;
      }
      update({ recovery: payload.undo });
    } catch {
      if (active(controller))
        update({ recoveryError: "Recovery is unavailable. Retry recovery." });
    } finally {
      if (active(controller)) update({ recovering: false });
      if (recoveryRequest.current === controller)
        recoveryRequest.current = null;
    }
  }

  function invalidateReads() {
    inspectionRequest.current?.abort();
    recoveryRequest.current?.abort();
    update({
      inspection: null,
      recovery: null,
      selected: null,
      inspecting: false,
      recovering: false,
      inspectionError: null,
      recoveryError: null,
    });
  }

  async function resetPassword(password: string) {
    const inspection = state.inspection;
    const regime = inspection?.regimes.find(
      (candidate) => candidate.id === state.selected && candidate.eligible,
    );
    if (
      mutation.current ||
      !mounted.current ||
      current.current !== identityKey ||
      !identity.canManagePasswords ||
      !identity.hasSave ||
      !inspection ||
      !regime ||
      !/^[\x20-\x7e]{1,128}$/.test(password)
    )
      return;
    const controller = new AbortController();
    mutation.current = controller;
    inspectionRequest.current?.abort();
    recoveryRequest.current?.abort();
    update({ pending: "reset", success: null, outcome: null, recovery: null });
    try {
      const response = await fetch(`${base}/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          fileVersionId: inspection.fileVersionId,
          sourceId: inspection.sourceId,
          expectedSaveBaseline: inspection.expectedSaveBaseline,
          regimeId: regime.id,
          password,
          confirmed: true,
        }),
      });
      if (!active(controller)) return;
      const payload: unknown = await response.json();
      if (!active(controller)) return;
      if (!response.ok && response.status < 500) {
        update({
          outcome: {
            kind: "rejected",
            message: errorMessage(
              payload,
              "Password reset was rejected. Inspect the latest save before trying again.",
            ),
          },
        });
      } else if (
        !response.ok ||
        !isPasswordReceipt(payload) ||
        payload.fileVersionId !== inspection.fileVersionId ||
        payload.regimeName !== regime.name ||
        payload.contentRevision !== inspection.contentRevision + 1
      ) {
        update({ outcome: { kind: "unknown" } });
      } else {
        update({ success: { ...payload, action: "reset" } });
        router.refresh();
      }
    } catch {
      if (active(controller)) update({ outcome: { kind: "unknown" } });
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (active(controller)) {
        invalidateReads();
        update({ pending: null });
        void inspect();
        void readRecovery();
      }
    }
  }

  async function undoPasswordReset() {
    const recovery = state.recovery;
    if (
      mutation.current ||
      !mounted.current ||
      current.current !== identityKey ||
      !identity.canManagePasswords ||
      !identity.hasSave ||
      state.selected ||
      !recovery
    )
      return;
    const controller = new AbortController();
    mutation.current = controller;
    inspectionRequest.current?.abort();
    recoveryRequest.current?.abort();
    update({ pending: "undo", success: null, outcome: null, inspection: null });
    try {
      const response = await fetch(`${base}/password-reset/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          resetId: recovery.resetId,
          outputId: recovery.outputId,
          outputRevision: recovery.outputRevision,
          expectedSaveBaseline: recovery.expectedSaveBaseline,
          confirmed: true,
        }),
      });
      if (!active(controller)) return;
      const payload: unknown = await response.json();
      if (!active(controller)) return;
      if (!response.ok && response.status < 500) {
        update({
          outcome: {
            kind: "rejected",
            message: errorMessage(
              payload,
              "Undo was rejected. Check fresh recovery before trying again.",
            ),
          },
        });
      } else if (
        !response.ok ||
        !isPasswordReceipt(payload) ||
        payload.resetId !== recovery.resetId ||
        payload.regimeName !== recovery.regimeName ||
        payload.contentRevision !== recovery.outputRevision + 1 ||
        (identity.saveRevision !== undefined &&
          !identity.saveRevision.startsWith(`${payload.fileVersionId}:`))
      ) {
        update({ outcome: { kind: "unknown" } });
      } else {
        update({ success: { ...payload, action: "undo" } });
        router.refresh();
      }
    } catch {
      if (active(controller)) update({ outcome: { kind: "unknown" } });
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (active(controller)) {
        invalidateReads();
        update({ pending: null });
        void inspect();
        void readRecovery();
      }
    }
  }

  useLayoutEffect(() => {
    current.current = identityKey;
    mounted.current = true;
    return () => {
      mounted.current = false;
      inspectionRequest.current?.abort();
      recoveryRequest.current?.abort();
      mutation.current?.abort();
      mutation.current = null;
    };
  }, [identityKey]);
  const load = useEffectEvent(() => {
    void inspect();
    void readRecovery();
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => load());
    return () => window.clearTimeout(timeout);
  }, [identityKey]);

  return {
    ...state,
    message:
      state.outcome?.kind === "unknown"
        ? unknownOutcome
        : (state.outcome?.message ?? null),
    inspect,
    readRecovery,
    resetPassword,
    undoPasswordReset,
    selectRegime(id: string) {
      if (
        mutation.current ||
        state.selected ||
        !state.inspection?.regimes.some(
          (regime) => regime.id === id && regime.eligible,
        )
      )
        return;
      recoveryRequest.current?.abort();
      update({ selected: id, recovery: null, recovering: false });
    },
    cancelReset() {
      if (!mutation.current) {
        update({ selected: null });
        void readRecovery();
      }
    },
    cancelUndo() {
      if (!mutation.current) update({ recovery: null });
    },
  };
}

function errorMessage(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback;
}
