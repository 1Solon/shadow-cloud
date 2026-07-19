"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CampaignConfigurationSection =
  "identity" | "world" | "turn-protocol" | "seat-order" | "notes";

export type CampaignEditorStateProps = {
  onDirtyChange: (isDirty: boolean) => void;
};

type CampaignConfigurationShellProps = {
  onExit: () => void;
  renderSection: (
    section: CampaignConfigurationSection,
    editorStateProps: CampaignEditorStateProps,
  ) => ReactNode;
};

const sections: Array<{
  id: CampaignConfigurationSection;
  label: string;
}> = [
  { id: "identity", label: "Identity & Progress" },
  { id: "world", label: "Campaign Setup" },
  { id: "turn-protocol", label: "Turn Reminders" },
  { id: "seat-order", label: "Seat Order" },
  { id: "notes", label: "Notes" },
];

export function CampaignConfigurationShell({
  onExit,
  renderSection,
}: CampaignConfigurationShellProps) {
  const [activeSection, setActiveSection] =
    useState<CampaignConfigurationSection>("identity");
  const [isDirty, setIsDirty] = useState(false);
  const configurationHeadingId = useId();
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousSectionRef = useRef(activeSection);
  const activeSectionDetails = sections.find(
    (section) => section.id === activeSection,
  )!;

  const onDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  useEffect(() => {
    if (previousSectionRef.current === activeSection) {
      return;
    }

    previousSectionRef.current = activeSection;
    editorHeadingRef.current?.focus();
  }, [activeSection]);

  function selectSection(section: CampaignConfigurationSection) {
    if (isDirty || section === activeSection) {
      return;
    }

    setIsDirty(false);
    setActiveSection(section);
  }

  return (
    <Card
      aria-labelledby={configurationHeadingId}
      className="min-w-0 overflow-hidden font-mono text-orange-200"
      role="region"
    >
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between">
          <div className="min-w-0">
            <CardTitle id={configurationHeadingId}>
              Configure campaign:
            </CardTitle>
            <CardDescription>
              Update campaign settings, seat order, notes, and turn reminders.
            </CardDescription>
          </div>
          <div className="shrink-0 self-start sm:self-stretch">
            <button
              type="button"
              disabled={isDirty}
              className="inline-flex h-full items-center justify-center border border-orange-400/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-300 transition-colors hover:bg-orange-400/10 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onExit}
            >
              Exit configuration
            </button>
          </div>
        </div>
      </CardHeader>

      <p
        className="border-t border-orange-400/25 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300/70 sm:px-6"
        data-testid="campaign-configuration-status"
      >
        [CONFIGURING: {activeSectionDetails.label.toUpperCase()}]
      </p>

      <div
        data-testid="campaign-configuration-layout"
        className="grid min-w-0 lg:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)]"
      >
        <div className="min-w-0 border-b border-orange-400/25 p-3 lg:border-r lg:border-b-0">
          <nav aria-label="Campaign configuration sections">
            <ul className="flex flex-col gap-1">
              {sections.map((section) => {
                const isActive = section.id === activeSection;

                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      disabled={isDirty && !isActive}
                      className={cn(
                        "w-full border-l-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
                        isActive
                          ? "border-orange-400 bg-orange-400/15 text-orange-100"
                          : "border-transparent text-orange-300/70 hover:border-orange-400/50 hover:bg-orange-400/10 hover:text-orange-200",
                      )}
                      onClick={() => selectSection(section.id)}
                    >
                      {section.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {isDirty ? (
            <p
              role="status"
              className="mt-3 border-t border-orange-400/20 px-3 pt-3 text-xs leading-relaxed text-orange-300/75"
            >
              Save or cancel {activeSectionDetails.label} before switching
              sections or leaving configuration.
            </p>
          ) : null}
        </div>

        <div key={activeSection} className="min-w-0 px-4 py-5 sm:px-6">
          <h3
            ref={editorHeadingRef}
            tabIndex={-1}
            className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {activeSectionDetails.label}
          </h3>
          {renderSection(activeSection, { onDirtyChange })}
        </div>
      </div>
    </Card>
  );
}
