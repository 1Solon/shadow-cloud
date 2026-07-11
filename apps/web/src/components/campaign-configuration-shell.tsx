"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
  { id: "world", label: "World Setup" },
  { id: "turn-protocol", label: "Turn Protocol" },
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
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMounted = useRef(false);
  const activeSectionDetails = sections.find(
    (section) => section.id === activeSection,
  )!;

  const onDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

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
    <section className="min-w-0 border border-orange-400/30 bg-black/50 font-mono text-orange-200">
      <header className="flex min-w-0 flex-col gap-3 border-b border-orange-400/25 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
          [CONFIGURING: {activeSectionDetails.label.toUpperCase()}]
        </p>
        <button
          type="button"
          disabled={isDirty}
          className="self-start border border-orange-400/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-300 transition-colors hover:bg-orange-400/10 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
          onClick={onExit}
        >
          Exit configuration
        </button>
      </header>

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

        <div className="min-w-0 px-4 py-5 sm:px-6">
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
    </section>
  );
}
