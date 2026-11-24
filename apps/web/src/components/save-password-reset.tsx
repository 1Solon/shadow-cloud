"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SaveInspection } from "@/lib/save-inspection";
import { fieldLabel } from "@/lib/terminal-styles";
import { SavePasswordReason, usePasswordReason } from "./save-password-reason";

export function SavePasswordReset({
  regime,
  onCancel,
  onReset,
  pending,
  requiresReason = false,
}: {
  regime: SaveInspection["regimes"][number];
  onCancel: () => void;
  onReset: (password: string, reason?: string) => Promise<void>;
  pending: boolean;
  requiresReason?: boolean;
}) {
  const [password, setPassword] = useState("");
  const reason = usePasswordReason(requiresReason);
  const [reveal, setReveal] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="space-y-4 rounded-md border border-terminal-400/20 bg-terminal-400/5 p-4 text-sm text-terminal-300"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending || !reason.ready) return;
        void onReset(password, reason.submitted);
        setPassword("");
        reason.clear();
        setReveal(false);
        setConfirmed(false);
      }}
    >
      <h3 className={fieldLabel}>Reset password for {regime.name}</h3>
      <div className="space-y-3 border-l-2 border-terminal-400/40 pl-4">
        <h4 className={fieldLabel}>Players must use the updated save</h4>
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
      <Label className="block space-y-2">
        <span className={`block ${fieldLabel}`}>Replacement password</span>
        <Input
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
      </Label>
      <p className="text-xs text-terminal-300/70">
        Use 1 to 128 printable ASCII characters. Share the replacement password
        privately. Shadow Cloud does not send it to players.
      </p>
      <Label className="flex items-start gap-2">
        <Checkbox
          checked={reveal}
          className="mt-1"
          disabled={pending}
          onCheckedChange={(checked) => setReveal(checked === true)}
        />
        Reveal replacement password
      </Label>
      {requiresReason ? (
        <SavePasswordReason
          label="Reason for resetting"
          value={reason.value}
          disabled={pending}
          onChange={reason.setValue}
        />
      ) : null}
      <Label className="flex items-start gap-2">
        <Checkbox
          checked={confirmed}
          className="mt-1"
          disabled={pending}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
        />
        Reset the password for {regime.name}. I have read the restart warning.
      </Label>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setPassword("");
            reason.clear();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || !confirmed || !password || !reason.ready}
        >
          {pending ? "Resetting password..." : "Reset password"}
        </Button>
      </div>
    </form>
  );
}
