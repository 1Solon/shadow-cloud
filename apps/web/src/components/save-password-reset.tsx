"use client";

import { useState } from "react";
import type { SaveInspection } from "@/lib/save-inspection";

export function SavePasswordReset({
  regime,
  onCancel,
  onReset,
  pending,
}: {
  regime: SaveInspection["regimes"][number];
  onCancel: () => void;
  onReset: (password: string) => Promise<void>;
  pending: boolean;
}) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="space-y-4 border border-orange-400/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        void onReset(password);
        setPassword("");
        setReveal(false);
        setConfirmed(false);
      }}
    >
      <h3 className="font-bold">Reset password for {regime.name}</h3>
      <div className="space-y-3 border-l-2 border-orange-400 pl-4">
        <h4 className="font-bold">Players must use the updated save</h4>
        <p>
          This changes the password in Shadow Cloud&apos;s latest save only.
          Copies already downloaded will not be updated.
        </p>
        <p>
          If the current player has started their turn, ask them to stop and
          restart that turn from the updated save. Uploading a turn played from
          the old copy could undo this password reset.
        </p>
        <p>This action does not advance the campaign&apos;s turn.</p>
      </div>
      <label className="block space-y-2">
        Replacement password
        <input
          className="block w-full min-w-0 border border-orange-400/50 bg-black p-2"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          spellCheck={false}
          required
          minLength={1}
          maxLength={128}
          pattern="[\x20-\x7e]{1,128}"
          value={password}
          disabled={pending}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="text-xs">
        Use 1 to 128 printable ASCII characters. Share the replacement password
        privately. Shadow Cloud does not send it to players.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={reveal}
          disabled={pending}
          onChange={(e) => setReveal(e.target.checked)}
        />
        Reveal replacement password
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Reset the password for {regime.name}. I have read the restart warning.
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          className="border border-orange-400 px-3 py-2 disabled:opacity-50"
          type="button"
          disabled={pending}
          onClick={() => {
            setPassword("");
            onCancel();
          }}
        >
          Cancel
        </button>
        <button
          className="border border-orange-400 bg-orange-400/10 px-3 py-2 disabled:opacity-50"
          type="submit"
          disabled={pending || !confirmed || !password}
        >
          {pending ? "Resetting password..." : "Reset password"}
        </button>
      </div>
    </form>
  );
}
