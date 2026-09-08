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
  it("allows natural mobile scrolling and contains desktop shells", async () => {
    const layout = await RootLayout({ children: <div>Campaign</div> });
    const body = layout.props.children;

    const classes = body.props.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["min-h-full", "md:h-full", "md:overflow-hidden"]),
    );
    expect(classes).not.toContain("overflow-hidden");
  });
});
