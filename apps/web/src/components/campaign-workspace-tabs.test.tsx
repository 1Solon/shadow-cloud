// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CampaignWorkspaceTabs } from "@/components/campaign-workspace-tabs";

function StatefulCampaign() {
  return <input aria-label="Notes draft" defaultValue="preserved draft" />;
}

function controlledPanel(tab: HTMLElement) {
  return document.getElementById(tab.getAttribute("aria-controls")!)!;
}

function renderWorkspace({ administration = false } = {}) {
  return render(
    <CampaignWorkspaceTabs
      activity={<p>Activity content</p>}
      campaign={<StatefulCampaign />}
      administration={
        administration ? <p>Administration content</p> : undefined
      }
    />,
  );
}

describe("CampaignWorkspaceTabs", () => {
  afterEach(cleanup);

  it("renders an accessible horizontal tablist with activity initially selected", () => {
    renderWorkspace();

    const tablist = screen.getByRole("tablist", {
      name: "Campaign workspace",
    });
    const activityTab = within(tablist).getByRole("tab", {
      name: "Activity",
    });
    const campaignTab = within(tablist).getByRole("tab", {
      name: "Campaign",
    });

    expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    expect(activityTab).toHaveAttribute("aria-selected", "true");
    expect(activityTab).toHaveAttribute("tabindex", "0");
    expect(campaignTab).toHaveAttribute("aria-selected", "false");
    expect(campaignTab).toHaveAttribute("tabindex", "-1");

    const activityPanel = controlledPanel(activityTab);
    const campaignPanel = controlledPanel(campaignTab);
    expect(activityPanel).toBeVisible();
    expect(campaignPanel).not.toBeVisible();
    expect(
      within(campaignPanel).getByLabelText("Notes draft"),
    ).toBeInTheDocument();
  });

  it("selects a clicked tab while preserving the inactive panel and its state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    await user.click(campaignTab);

    expect(campaignTab).toHaveAttribute("aria-selected", "true");
    expect(campaignTab).toHaveAttribute("tabindex", "0");
    expect(activityTab).toHaveAttribute("aria-selected", "false");
    expect(activityTab).toHaveAttribute("tabindex", "-1");
    expect(controlledPanel(activityTab)).not.toBeVisible();
    expect(screen.getByRole("tabpanel", { name: "Campaign" })).toBeVisible();

    await user.clear(screen.getByLabelText("Notes draft"));
    await user.type(screen.getByLabelText("Notes draft"), "preserved draft");
    await user.click(activityTab);
    await user.click(campaignTab);

    expect(screen.getByLabelText("Notes draft")).toHaveValue("preserved draft");
  });

  it("selects and focuses the next tab with ArrowRight", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    activityTab.focus();
    await user.keyboard("[ArrowRight]");

    expect(campaignTab).toHaveFocus();
    expect(campaignTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Campaign" })).toBeVisible();
  });

  it("wraps arrow navigation when administration is available", async () => {
    const user = userEvent.setup();
    renderWorkspace({ administration: true });
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const administrationTab = screen.getByRole("tab", {
      name: "Administration",
    });

    administrationTab.focus();
    await user.keyboard("[ArrowRight]");
    expect(activityTab).toHaveFocus();
    expect(activityTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("[ArrowLeft]");
    expect(administrationTab).toHaveFocus();
    expect(administrationTab).toHaveAttribute("aria-selected", "true");
  });

  it("moves to the first and last available tabs with Home and End", async () => {
    const user = userEvent.setup();
    renderWorkspace({ administration: true });
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });
    const administrationTab = screen.getByRole("tab", {
      name: "Administration",
    });

    campaignTab.focus();
    await user.keyboard("[End]");
    expect(administrationTab).toHaveFocus();
    expect(administrationTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("[Home]");
    expect(activityTab).toHaveFocus();
    expect(activityTab).toHaveAttribute("aria-selected", "true");
  });

  it("uses campaign as the last tab when administration is omitted", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const campaignTab = screen.getByRole("tab", { name: "Campaign" });

    expect(
      screen.queryByRole("tab", { name: "Administration", hidden: true }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(2);

    activityTab.focus();
    await user.keyboard("[End]");
    expect(campaignTab).toHaveFocus();
    expect(campaignTab).toHaveAttribute("aria-selected", "true");
  });

  it("links every tab to a uniquely identified labelled panel", () => {
    renderWorkspace({ administration: true });
    const tabs = screen.getAllByRole("tab");
    const panels = screen.getAllByRole("tabpanel", { hidden: true });

    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(panels.length);
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      const panel = document.getElementById(panelId!);
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }
  });

  it("keeps tab and panel IDs unique across multiple workspaces", () => {
    render(
      <>
        <CampaignWorkspaceTabs
          activity="First activity"
          campaign="First campaign"
        />
        <CampaignWorkspaceTabs
          activity="Second activity"
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

  it("provides horizontal overflow containment and min-width escape hatches", () => {
    const { container } = renderWorkspace();
    const root = container.firstElementChild!;
    const tablist = screen.getByRole("tablist", {
      name: "Campaign workspace",
    });
    const navigationWrapper = tablist.parentElement!;
    const panels = screen.getAllByRole("tabpanel", { hidden: true });

    expect(root).toHaveClass("min-w-0");
    expect(navigationWrapper).toHaveClass(
      "overflow-x-auto",
      "overflow-y-hidden",
    );
    expect(tablist).toHaveClass("min-w-max");
    for (const panel of panels) {
      expect(panel).toHaveClass("min-w-0");
    }
  });
});
