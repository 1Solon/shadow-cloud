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
    <section className="m-6 border border-orange-400/30 bg-black p-6 font-mono text-orange-200">
      <div role="alert">
        <p>Campaigns could not be loaded.</p>
        <p>Retrying automatically every minute.</p>
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
