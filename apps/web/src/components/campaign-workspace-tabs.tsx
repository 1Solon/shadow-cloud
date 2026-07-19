"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type WorkspaceTabId = "saves" | "timing" | "campaign" | "administration";

export type CampaignWorkspaceTabsProps = {
  saves: ReactNode;
  timing: ReactNode;
  campaign: ReactNode;
  administration?: ReactNode;
};

const tabButtonClassName =
  "h-11 shrink-0 whitespace-nowrap border-b-2 px-4 font-mono text-sm font-semibold uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function CampaignWorkspaceTabs({
  saves,
  timing,
  campaign,
  administration,
}: CampaignWorkspaceTabsProps) {
  const baseId = useId();
  const [selectedTabId, setSelectedTabId] = useState<WorkspaceTabId>("saves");
  const tabRefs = useRef<Record<WorkspaceTabId, HTMLButtonElement | null>>({
    saves: null,
    timing: null,
    campaign: null,
    administration: null,
  });
  const tabs: Array<{
    id: WorkspaceTabId;
    label: string;
    content: ReactNode;
  }> = [
    { id: "saves", label: "Saves", content: saves },
    { id: "timing", label: "Timing", content: timing },
    { id: "campaign", label: "Campaign", content: campaign },
    ...(administration != null
      ? [
          {
            id: "administration" as const,
            label: "Administration",
            content: administration,
          },
        ]
      : []),
  ];
  const selectedTabIsAvailable = tabs.some((tab) => tab.id === selectedTabId);
  const activeTabId = selectedTabIsAvailable ? selectedTabId : "saves";

  if (!selectedTabIsAvailable) {
    setSelectedTabId("saves");
  }

  function selectAndFocus(tabId: WorkspaceTabId) {
    setSelectedTabId(tabId);
    tabRefs.current[tabId]?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) {
    let targetIndex: number | undefined;

    switch (event.key) {
      case "ArrowRight":
        targetIndex = (tabIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        targetIndex = (tabIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        targetIndex = 0;
        break;
      case "End":
        targetIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectAndFocus(tabs[targetIndex].id);
  }

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto overflow-y-hidden border-b border-orange-400/30">
        <div
          aria-label="Campaign workspace"
          aria-orientation="horizontal"
          className="flex min-w-max px-1 pt-1"
          role="tablist"
        >
          {tabs.map((tab, tabIndex) => {
            const selected = activeTabId === tab.id;
            const tabId = `${baseId}-${tab.id}-tab`;
            const panelId = `${baseId}-${tab.id}-panel`;

            return (
              <button
                aria-controls={panelId}
                aria-selected={selected}
                className={`${tabButtonClassName} ${
                  selected
                    ? "border-orange-400 bg-orange-400 text-black"
                    : "border-transparent text-orange-300 hover:border-orange-400/60 hover:bg-orange-400/10 hover:text-orange-200"
                }`}
                id={tabId}
                key={tab.id}
                onClick={() => setSelectedTabId(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tabIndex)}
                ref={(element) => {
                  tabRefs.current[tab.id] = element;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {tabs.map((tab) => {
        const selected = activeTabId === tab.id;

        return (
          <div
            aria-labelledby={`${baseId}-${tab.id}-tab`}
            className="min-w-0 pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            hidden={!selected}
            id={`${baseId}-${tab.id}-panel`}
            key={tab.id}
            role="tabpanel"
            tabIndex={0}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
