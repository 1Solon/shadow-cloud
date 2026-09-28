"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <Label className="block space-y-2">
        Replacement password
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
      <p className="text-xs">
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
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setPassword("");
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !confirmed || !password}>
          {pending ? "Resetting password..." : "Reset password"}
        </Button>
      </div>
    </form>
  );
}
