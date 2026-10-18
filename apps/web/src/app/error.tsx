"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const retryIntervalMs = 60_000;

export default function CampaignListError({ retry }: { retry: () => void }) {
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      retry();
    }, retryIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [retry]);

  return (
    <section className="m-6 rounded-lg border border-terminal-400/20 p-6 font-mono">
      <div role="alert" className="flex flex-col gap-1">
        <p className="text-lg uppercase text-terminal-300">
          &gt; Campaigns could not be loaded
        </p>
        <p className="text-sm text-terminal-300/70">
          Retrying automatically every minute.
        </p>
      </div>
      <Button
        className="mt-4"
        type="button"
        variant="outline"
        onClick={() => retry()}
      >
        Retry now
      </Button>
    </section>
  );
}
