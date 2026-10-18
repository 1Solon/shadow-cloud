"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountTrigger } from "@/components/account-trigger";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  name: string;
  image: string | null | undefined;
  canOverride: boolean;
  overrideEnabled: boolean;
};

const menuItemClassName = "text-xs font-bold uppercase tracking-[0.14em]";

export function AccountMenu({
  name,
  image,
  canOverride,
  overrideEnabled,
}: AccountMenuProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] =
    useState<TerminalActionConfirmationSpec | null>(null);
  const isOverrideSelected = useRef(false);

  function openOverrideConfirmation() {
    const nextEnabled = !overrideEnabled;

    setConfirmation({
      title: "Confirm override change",
      command: nextEnabled
        ? "shadow-override --enable"
        : "shadow-override --disable",
      lines: [
        nextEnabled
          ? "Privileged campaign controls will become visible for this session."
          : "Privileged campaign controls will be hidden for this session.",
      ],
      confirmLabel: nextEnabled ? "Enable" : "Disable",
    });
  }

  function confirmOverrideChange() {
    const nextEnabled = !overrideEnabled;

    startTransition(async () => {
      await fetch("/api/shadow-override", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: nextEnabled,
        }),
      });

      setConfirmation(null);
      router.refresh();
    });
  }

  return (
    <>
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending={isPending}
        onCancel={() => {
          setConfirmation(null);
        }}
        onConfirm={confirmOverrideChange}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild aria-label="Account menu">
          <AccountTrigger
            name={name}
            image={image}
            overrideEnabled={overrideEnabled}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={() => {
            if (isOverrideSelected.current) {
              isOverrideSelected.current = false;
              openOverrideConfirmation();
            }
          }}
        >
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.16em] text-terminal-300/70">
              Connected as
            </span>
            <span className="max-w-56 truncate text-terminal-300">{name}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canOverride ? (
            <DropdownMenuItem
              className={cn(
                menuItemClassName,
                overrideEnabled && "text-destructive",
              )}
              disabled={isPending}
              onSelect={() => {
                isOverrideSelected.current = true;
              }}
            >
              {overrideEnabled ? "Disable override" : "Enable override"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className={menuItemClassName}
            onSelect={() => signOut()}
          >
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
