// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CampaignWorkspaceTabs } from "@/components/campaign-workspace-tabs";

function StatefulCampaign() {
  return <input aria-label="Notes draft" defaultValue="" />;
}

function controlledPanel(tab: HTMLElement) {
  return document.getElementById(tab.getAttribute("aria-controls")!)!;
}

function renderWorkspace({ administration = false } = {}) {
  return render(
    <CampaignWorkspaceTabs
      saves={<p>Saves content</p>}
      timing={<p>Timing content</p>}
      campaign={<StatefulCampaign />}
      administration={
        administration ? <p>Administration content</p> : undefined
      }
    />,
  );
}

describe("CampaignWorkspaceTabs", () => {
  afterEach(cleanup);

  it("renders Saves and Timing in the workspace row with Saves initially selected", () => {
    renderWorkspace();

    const tablist = screen.getByRole("tablist", {
      name: "Campaign workspace",
    });
    const savesTab = within(tablist).getByRole("tab", { name: "Saves" });
    const timingTab = within(tablist).getByRole("tab", { name: "Timing" });
    const campaignTab = within(tablist).getByRole("tab", {
      name: "Campaign",
    });

    expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    expect(within(tablist).queryByRole("tab", { name: "Activity" })).toBeNull();
    expect(savesTab).toHaveAttribute("aria-selected", "true");
    expect(savesTab).toHaveAttribute("tabindex", "0");
    expect(timingTab).toHaveAttribute("aria-selected", "false");
    expect(campaignTab).toHaveAttribute("aria-selected", "false");
    expect(controlledPanel(savesTab)).toBeVisible();
    expect(controlledPanel(timingTab)).not.toBeVisible();
    expect(controlledPanel(campaignTab)).not.toBeVisible();
  });

  it("selects a clicked tab while preserving inactive panel state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    await user.click(campaignTab);
    await user.type(screen.getByLabelText("Notes draft"), "preserved draft");
    await user.click(savesTab);
    await user.click(campaignTab);

    expect(campaignTab).toHaveFocus();
    expect(campaignTab).toHaveAttribute("aria-selected", "true");
    expect(savesTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Notes draft")).toHaveValue("preserved draft");
  });

  it("selects and focuses tabs with arrow keys", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const timingTab = screen.getByRole("tab", { name: "Timing" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    savesTab.focus();
    await user.keyboard("[ArrowRight]");
    expect(timingTab).toHaveFocus();
    expect(timingTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("[ArrowRight]");
    expect(campaignTab).toHaveFocus();

    await user.keyboard("[ArrowLeft]");
    expect(timingTab).toHaveFocus();
  });

  it("wraps arrow navigation when administration is available", async () => {
    const user = userEvent.setup();
    renderWorkspace({ administration: true });
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const administrationTab = screen.getByRole("tab", {
      name: "Administration",
    });

    administrationTab.focus();
    await user.keyboard("[ArrowRight]");
    expect(savesTab).toHaveFocus();

    await user.keyboard("[ArrowLeft]");
    expect(administrationTab).toHaveFocus();
  });

  it("moves to the first and last available tabs with Home and End", async () => {
    const user = userEvent.setup();
    renderWorkspace({ administration: true });
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const timingTab = screen.getByRole("tab", { name: "Timing" });
    const administrationTab = screen.getByRole("tab", {
      name: "Administration",
    });

    timingTab.focus();
    await user.keyboard("[End]");
    expect(administrationTab).toHaveFocus();

    await user.keyboard("[Home]");
    expect(savesTab).toHaveFocus();
  });

  it("omits administration and uses Campaign as the last tab", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
    expect(screen.queryByRole("tab", { name: "Administration" })).toBeNull();

    savesTab.focus();
    await user.keyboard("[End]");
    expect(campaignTab).toHaveFocus();
  });

  it("returns to Saves when the selected administration tab is removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CampaignWorkspaceTabs
        saves="Saves content"
        timing="Timing content"
        campaign="Campaign content"
        administration="Administration content"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Administration" }));

    rerender(
      <CampaignWorkspaceTabs
        saves="Saves content"
        timing="Timing content"
        campaign="Campaign content"
      />,
    );

    const savesTab = screen.getByRole("tab", { name: "Saves" });
    expect(savesTab).toHaveAttribute("aria-selected", "true");
    expect(controlledPanel(savesTab)).toBeVisible();
  });

  it("links every tab to a uniquely identified labelled panel", () => {
    renderWorkspace({ administration: true });
    const tabs = screen.getAllByRole("tab");
    const panels = screen.getAllByRole("tabpanel", { hidden: true });

    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(panels.length);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }
  });

  it("keeps tab and panel IDs unique across multiple workspaces", () => {
    render(
      <>
        <CampaignWorkspaceTabs
          saves="First saves"
          timing="First timing"
          campaign="First campaign"
        />
        <CampaignWorkspaceTabs
          saves="Second saves"
          timing="Second timing"
          campaign="Second campaign"
        />
      </>,
    );

    const elements = [
      ...screen.getAllByRole("tab"),
      ...screen.getAllByRole("tabpanel", { hidden: true }),
    ];
    expect(elements.every((element) => element.id.length > 0)).toBe(true);
    expect(new Set(elements.map((element) => element.id)).size).toBe(
      elements.length,
    );
  });

  it("applies workspace overflow and tab state styles", () => {
    const { container } = renderWorkspace();
    const root = container.firstElementChild!;
    const tablist = screen.getByRole("tablist", {
      name: "Campaign workspace",
    });
    const navigationWrapper = tablist.parentElement!;
    const savesTab = screen.getByRole("tab", { name: "Saves" });
    const timingTab = screen.getByRole("tab", { name: "Timing" });

    expect(root).toHaveClass("min-w-0");
    expect(navigationWrapper).toHaveClass(
      "overflow-x-auto",
      "overflow-y-hidden",
      "border-b",
      "border-orange-400/30",
    );
    expect(tablist).toHaveClass("flex", "min-w-max", "px-1", "pt-1");
    expect(savesTab).toHaveClass(
      "h-11",
      "border-b-2",
      "border-orange-400",
      "bg-orange-400",
      "text-black",
    );
    expect(timingTab).toHaveClass(
      "border-transparent",
      "text-orange-300",
      "hover:border-orange-400/60",
    );
    for (const panel of screen.getAllByRole("tabpanel", { hidden: true })) {
      expect(panel).toHaveClass(
        "min-w-0",
        "pt-6",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
      );
    }
  });
});
