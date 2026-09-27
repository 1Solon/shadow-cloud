"use client";

import { useEffect } from "react";

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
      <button
        className="mt-4 border border-orange-400/40 px-3 py-2"
        type="button"
        onClick={() => retry()}
      >
        Retry now
      </button>
    </section>
  );
}
