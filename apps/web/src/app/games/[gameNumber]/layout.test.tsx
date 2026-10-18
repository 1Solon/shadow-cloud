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
vi.mock("@/components/terminal-frame", () => ({
  TerminalFrame: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/lib/shadow-cloud-api", () => ({
  getGameDetail: mocks.getGameDetail,
}));
vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: mocks.getShadowOverrideEnabled,
}));

const { default: GameLayout } = await import("./layout");

type ElementProps = {
  children?: ReactNode;
  className?: string;
  homeLink?: boolean;
  game?: { name: string; tagline: string | null };
  roundNumber?: number;
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
      gameNumber: 7,
      name: "A Campaign Name That Can Wrap",
      tagline: "4S FFA+AI T3",
      roundNumber: 3,
    });
    mocks.getShadowOverrideEnabled.mockResolvedValue(false);
  });

  it("frames the campaign in the shared terminal panel with a home link", async () => {
    const layout = await GameLayout({
      children: <section>Campaign workspace</section>,
      params: Promise.resolve({ gameNumber: "7" }),
    });
    const elements = elementsIn(layout);

    const main = elementWithClasses(elements, "min-h-dvh");
    expect(main?.props.className?.split(/\s+/)).toContain("md:overflow-hidden");
    expect(main?.props.className?.split(/\s+/)).not.toContain(
      "overflow-hidden",
    );
    expect(main?.props.className).toContain("p-2");
    expect(main?.props.className).toContain("sm:p-4");

    expect(elements.some((element) => element.props.homeLink)).toBe(true);
  });

  it("names the campaign in a segment strip under the header", async () => {
    const layout = await GameLayout({
      children: <section>Campaign workspace</section>,
      params: Promise.resolve({ gameNumber: "7" }),
    });
    const elements = elementsIn(layout);

    const strip = elementWithClasses(elements, "divide-x", "shrink-0");
    const stripElements = elementsIn(strip);
    const number = stripElements.find((element) =>
      [element.props.children].flat().includes("07"),
    );
    expect(number).toBeDefined();
    expect(
      elementsIn(number!).find(
        (element) => element.props.className === "sr-only",
      )?.props.children,
    ).toBe("Campaign ");
    expect(
      stripElements.find((element) => element.props.roundNumber !== undefined)
        ?.props.roundNumber,
    ).toBe(3);
    expect(
      stripElements.find((element) => element.props.game)?.props.game,
    ).toMatchObject({
      name: "A Campaign Name That Can Wrap",
      tagline: "4S FFA+AI T3",
    });
  });

  it("restricts inner scrolling to desktop page content", async () => {
    const child = <section>Campaign workspace</section>;
    const layout = await GameLayout({
      children: child,
      params: Promise.resolve({ gameNumber: "7" }),
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
    expect(scrollers[0]?.props.className?.split(/\s+/)).not.toContain(
      "overflow-y-auto",
    );
  });
});
