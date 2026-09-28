"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WorkspaceTabId =
  "saves" | "timing" | "campaign" | "regimes" | "administration";

export type CampaignWorkspaceTabsProps = {
  saves: ReactNode;
  timing: ReactNode;
  campaign: ReactNode;
  regimes?: ReactNode;
  administration?: ReactNode;
};

export function CampaignWorkspaceTabs({
  saves,
  timing,
  campaign,
  regimes,
  administration,
}: CampaignWorkspaceTabsProps) {
  const [selectedTabId, setSelectedTabId] = useState<WorkspaceTabId>("saves");
  const [mountedRegimes, setMountedRegimes] = useState(false);
  const tabs: Array<{
    id: WorkspaceTabId;
    label: string;
    content: ReactNode;
  }> = [
    { id: "saves", label: "Saves", content: saves },
    { id: "timing", label: "Timing", content: timing },
    { id: "campaign", label: "Campaign", content: campaign },
    ...(regimes != null
      ? [{ id: "regimes" as const, label: "Regimes", content: regimes }]
      : []),
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

  function selectTab(tabId: WorkspaceTabId) {
    if (tabId === "regimes") setMountedRegimes(true);
    setSelectedTabId(tabId);
  }

  return (
    <Tabs
      className="min-w-0 md:flex md:grow md:flex-col"
      value={activeTabId}
      onValueChange={(value) => selectTab(value as WorkspaceTabId)}
    >
      <div className="overflow-x-auto overflow-y-hidden border-b border-terminal-400/30">
        <TabsList
          aria-label="Campaign workspace"
          className="min-w-max px-1 pt-1"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {tabs.map((tab) => (
        <TabsContent
          className="pt-4 sm:pt-6 md:flex md:grow md:flex-col"
          forceMount
          hidden={activeTabId !== tab.id}
          key={tab.id}
          value={tab.id}
        >
          {tab.id !== "regimes" || mountedRegimes ? tab.content : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
