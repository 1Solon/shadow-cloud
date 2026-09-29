"use client";

import { useState, useSyncExternalStore } from "react";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Release, releasesPageUrl } from "@/lib/github-releases";
import { cn } from "@/lib/utils";

type WhatsNewDialogProps = {
  label: string;
  releases: Release[];
};

const lastSeenReleaseKey = "shadow-cloud:last-seen-release";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function getLastSeenRelease() {
  return window.localStorage.getItem(lastSeenReleaseKey);
}

export function WhatsNewDialog({ label, releases }: WhatsNewDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const latestRelease = releases[0]?.name;
  const lastSeenRelease = useSyncExternalStore(
    subscribeToStorage,
    getLastSeenRelease,
    () => latestRelease,
  );
  const hasUnseenRelease =
    latestRelease !== undefined && lastSeenRelease !== latestRelease;

  return (
    <>
      <Button
        className={cn(
          "-ml-1.5 h-auto px-1.5 py-0.5 text-xs",
          hasUnseenRelease
            ? "animate-pulse motion-reduce:animate-none"
            : "font-normal text-terminal-300/70 hover:text-terminal-300",
        )}
        title="What's new"
        type="button"
        variant={hasUnseenRelease ? "default" : "ghost"}
        onClick={() => {
          if (latestRelease !== undefined) {
            window.localStorage.setItem(lastSeenReleaseKey, latestRelease);
          }
          setIsOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[calc(100dvh-6rem)] max-w-2xl flex-col"
        >
          <DialogHeader>
            <DialogTitle>What&apos;s new</DialogTitle>
            <DialogCloseButton
              aria-label="Close what's new"
              onClick={() => setIsOpen(false)}
            />
          </DialogHeader>
          <DialogBody className="min-h-0 space-y-6 overflow-y-auto sm:px-5 sm:py-5">
            {releases.length > 0 ? (
              releases.map((release) => (
                <section key={release.name} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-base font-semibold text-terminal-100">
                      {release.name}
                    </h2>
                    <time
                      dateTime={release.publishedAt}
                      className="text-xs text-terminal-300/70"
                    >
                      {release.publishedAt.slice(0, 10)}
                    </time>
                  </div>
                  <GameNotesMarkdown content={release.body} />
                </section>
              ))
            ) : (
              <p className="text-sm">Release notes could not be loaded.</p>
            )}
            <DialogFooter>
              <Button asChild size="sm" variant="outline">
                <a href={releasesPageUrl} target="_blank" rel="noreferrer">
                  All releases on GitHub
                </a>
              </Button>
            </DialogFooter>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
