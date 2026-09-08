import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGameDetail: vi.fn(),
  getServerAuthSession: vi.fn(),
  getShadowOverrideEnabled: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/auth", () => ({
  getServerAuthSession: mocks.getServerAuthSession,
}));
vi.mock("@/components/login-button", () => ({
  LoginButton: () => <button>Log in</button>,
}));
vi.mock("@/components/shadow-override-button", () => ({
  ShadowOverrideButton: () => <button>Override</button>,
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button>Sign out</button>,
}));
vi.mock("@/components/terminal-clock", () => ({
  TerminalClock: () => <span>Clock</span>,
}));
vi.mock("@/components/user-badge", () => ({
  UserBadge: () => <span>User</span>,
}));
vi.mock("@/lib/component-versions", () => ({
  componentVersionStatus: "VERSION",
}));
vi.mock("@/lib/shadow-cloud-api", () => ({
  getGameDetail: mocks.getGameDetail,
}));
vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: mocks.getShadowOverrideEnabled,
}));
vi.mock("@/lib/terminal-clock", () => ({
  formatTerminalClock: () => "00:00:00",
}));

const { default: GameLayout } = await import("./layout");

type ElementProps = {
  children?: ReactNode;
  className?: string;
};

function elementsIn(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) {
    return [];
  }

  return [
    node,
    ...Children.toArray(node.props.children).flatMap((child) =>
      elementsIn(child),
    ),
  ];
}

function elementWithClasses(
  elements: ReactElement<ElementProps>[],
  ...classes: string[]
) {
  return elements.find((element) => {
    const classNames = element.props.className?.split(/\s+/) ?? [];
    return classes.every((className) => classNames.includes(className));
  });
}

describe("GameLayout", () => {
  beforeEach(() => {
    mocks.getServerAuthSession.mockResolvedValue(null);
    mocks.getGameDetail.mockResolvedValue({
      gameNumber: 42,
      name: "A Campaign Name That Can Wrap",
    });
    mocks.getShadowOverrideEnabled.mockResolvedValue(false);
  });

  it("uses compact mobile framing and a viewport-contained desktop shell", async () => {
    const child = <section>Campaign workspace</section>;
    const layout = await GameLayout({
      children: child,
      params: Promise.resolve({ gameNumber: "42" }),
    });
    const elements = elementsIn(layout);

    const main = elementWithClasses(elements, "min-h-dvh");
    expect(main?.props.className?.split(/\s+/)).toContain("md:overflow-hidden");
    expect(main?.props.className?.split(/\s+/)).not.toContain(
      "overflow-hidden",
    );
    expect(main?.props.className).toContain("p-2");
    expect(main?.props.className).toContain("sm:p-4");

    const frame = elementWithClasses(elements, "shadow-2xl");
    expect(frame?.props.className).toContain("p-3");
    expect(frame?.props.className).toContain("sm:p-6");
    expect(frame?.props.className).toContain("overflow-hidden");

    const header = elementWithClasses(elements, "border-b", "pb-3", "mb-4");
    expect(header?.props.className).toContain("flex-wrap");
    expect(header?.props.className).toContain("gap-3");

    const titleGroup = elementWithClasses(elements, "flex-1", "sm:gap-4");
    expect(titleGroup?.props.className).toContain("min-w-0");
    expect(titleGroup?.props.className).toContain("basis-full");
    expect(titleGroup?.props.className).toContain("sm:basis-0");

    const title = elementWithClasses(elements, "sm:text-xl", "font-mono");
    expect(title?.props.className).toContain("min-w-0");
    expect(title?.props.className).toContain("break-words");
    expect(title?.props.className).toContain("text-base");

    const accountGroup = elementWithClasses(
      elements,
      "justify-end",
      "sm:gap-4",
    );
    expect(accountGroup?.props.className).toContain("flex-wrap");
    expect(accountGroup?.props.className).toContain("gap-2");
    expect(accountGroup?.props.className).toContain("w-full");
    expect(accountGroup?.props.className).toContain("max-w-full");
    expect(accountGroup?.props.className).toContain("sm:w-auto");

    const status = elementWithClasses(elements, "mt-4", "border-t");
    expect(status?.props.className).toContain("flex-wrap");
    expect(status?.props.className).toContain("gap-2");
  });

  it("restricts inner scrolling to desktop page content", async () => {
    const child = <section>Campaign workspace</section>;
    const layout = await GameLayout({
      children: child,
      params: Promise.resolve({ gameNumber: "42" }),
    });
    const elements = elementsIn(layout);
    const scrollClasses = [
      "md:overflow-y-auto",
      "md:overflow-auto",
      "md:overflow-scroll",
    ];
    const scrollers = elements.filter((element) => {
      const classNames = element.props.className?.split(/\s+/) ?? [];
      return scrollClasses.some((className) => classNames.includes(className));
    });

    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]?.props.children).toBe(child);
    expect(scrollers[0]?.props.className?.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "flex-1",
        "min-h-0",
        "md:overflow-y-auto",
        "md:pr-2",
      ]),
    );
    expect(scrollers[0]?.props.className).not.toContain("overflow-x-auto");

    expect(scrollers[0]?.props.className?.split(/\s+/)).not.toContain(
      "overflow-y-auto",
    );
    const header = elementWithClasses(elements, "border-b", "pb-3", "mb-4");
    const status = elementWithClasses(elements, "mt-4", "border-t");
    expect(header?.props.className).not.toContain("overflow-y-auto");
    expect(status?.props.className).not.toContain("overflow-y-auto");
  });
});
