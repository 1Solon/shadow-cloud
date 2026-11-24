"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel } from "@/lib/terminal-styles";

export const MAX_PASSWORD_REASON_LENGTH = 500;

export function isPasswordReason(reason: string) {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PASSWORD_REASON_LENGTH;
}

export function usePasswordReason(required: boolean) {
  const [value, setValue] = useState("");
  return {
    value,
    setValue,
    ready: !required || isPasswordReason(value),
    submitted: required ? value.trim() : undefined,
    clear: () => setValue(""),
  };
}

export function SavePasswordReason({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const hint = useId();
  return (
    <div className="space-y-2">
      <Label className="block space-y-2">
        <span className={`block ${fieldLabel}`}>{label}</span>
        <Textarea
          aria-describedby={hint}
          required
          maxLength={MAX_PASSWORD_REASON_LENGTH}
          rows={2}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </Label>
      <p id={hint} className="text-xs text-terminal-300/70">
        You aren&apos;t this campaign&apos;s Overlord. Say how the Overlord
        approved this. It appears in save history.
      </p>
    </div>
  );
}
