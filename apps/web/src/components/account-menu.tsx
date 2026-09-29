"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ChevronDownIcon } from "lucide-react";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserBadge } from "@/components/user-badge";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  name: string;
  image: string | null | undefined;
  canOverride: boolean;
  overrideEnabled: boolean;
};

const menuItemClassName = "text-xs uppercase tracking-[0.18em]";

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
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="flex min-w-0 items-center gap-2 rounded-md p-1 text-terminal-300 transition-colors hover:bg-terminal-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <UserBadge name={name} image={image} isSignedIn />
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
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
