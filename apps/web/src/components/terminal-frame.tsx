import type { ReactNode } from "react";
import Link from "next/link";
import type { Session } from "next-auth";
import { AccountMenu } from "@/components/account-menu";
import { GuestAccount } from "@/components/guest-account";
import { TerminalTitle } from "@/components/terminal-title";
import { WhatsNewDialog } from "@/components/whats-new-dialog";
import { applicationVersion } from "@/lib/component-versions";
import { listReleases } from "@/lib/github-releases";

type TerminalFrameProps = {
  user: Session["user"] | undefined;
  overrideEnabled: boolean;
  homeLink?: boolean;
  children: ReactNode;
};

const titleClassName = "text-[4px] text-terminal-300 sm:text-[5px]";

async function VersionTag() {
  const releases = await listReleases();

  return (
    <WhatsNewDialog label={`v${applicationVersion}`} releases={releases} />
  );
}

export function TerminalFrame({
  user,
  overrideEnabled,
  homeLink = false,
  children,
}: TerminalFrameProps) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col rounded-lg border border-terminal-400 bg-card p-3 shadow-2xl shadow-terminal-400/20 sm:p-6 md:overflow-hidden">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-terminal-400 pb-3">
        <div className="flex flex-col items-start gap-1">
          {homeLink ? (
            <Link
              href="/"
              aria-label="Shadow Cloud home"
              className="rounded-sm transition-colors hover:text-terminal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TerminalTitle className={titleClassName} />
            </Link>
          ) : (
            <TerminalTitle className={titleClassName} />
          )}
          <div className="pl-[4ch] text-[4px] sm:text-[5px]">
            <VersionTag />
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-start gap-3 self-stretch">
          {user ? (
            <AccountMenu
              name={user.name ?? user.email ?? "Lord"}
              image={user.image}
              canOverride={Boolean(user.isShadowOverride)}
              overrideEnabled={overrideEnabled}
            />
          ) : (
            <GuestAccount />
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
