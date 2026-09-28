"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { transferOutcomeMessage } from "@/lib/transfer-outcome";

// This parent boundary also catches failures in the campaign's server layout.
export default function CampaignReadError() {
  const outcomes = useSearchParams().getAll("transferOutcome");
  const notice = transferOutcomeMessage(
    outcomes.length === 1 ? outcomes[0] : null,
    "unavailable",
  );
  return (
    <section className="m-6 border border-terminal-400/30 bg-background p-6 font-mono text-terminal-200">
      <div role="alert">
        {notice ? <p>{notice}</p> : null}
        <p>Campaign data could not be reloaded.</p>
        <p>Editing is unavailable until current ownership can be checked.</p>
      </div>
      <Button
        className="mt-4"
        type="button"
        variant="outline"
        onClick={() => window.location.reload()}
      >
        Reload campaign
      </Button>
    </section>
  );
}
