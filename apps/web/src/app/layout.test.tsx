import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "geist-sans" }),
  Geist_Mono: () => ({ variable: "geist-mono" }),
}));

vi.mock("@/components/session-provider", () => ({
  AppSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: vi.fn().mockResolvedValue(false),
}));

const { default: RootLayout } = await import("./layout");

describe("RootLayout", () => {
  it("locks viewport shells to the document without body overscroll", async () => {
    const layout = await RootLayout({ children: <div>Campaign</div> });
    const body = layout.props.children;

    expect(body.props.className).toContain("h-full");
    expect(body.props.className).toContain("overflow-hidden");
    expect(body.props.className).not.toContain("min-h-full");
  });
});
