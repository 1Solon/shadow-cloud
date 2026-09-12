import { useEffect, useId, useRef } from "react";

const detections = [
  {
    star: "STAR 01",
    status: "SHADOW PAWNS: PRESENT",
    position: [0.2, 0.29],
    size: 0.9,
    offset: [45, -24],
  },
  {
    star: "STAR 02",
    status: "SHADOW PAWNS: ABSENT",
    position: [0.37, 0.72],
    size: 0.7,
    offset: [-50, 34],
  },
  {
    star: "STAR 03",
    status: "SHADOW PAWNS: PRESENT",
    position: [0.65, 0.34],
    size: 1.1,
    offset: [50, 38],
  },
  {
    star: "STAR 04",
    status: "SHADOW PAWNS: ABSENT",
    position: [0.83, 0.7],
    size: 0.8,
    offset: [-50, 32],
  },
] as const;

const backgroundStars = Array.from({ length: 90 }, (_, index) => {
  const horizontal = Math.sin((index + 1) * 127.1) * 43758.5453;
  const vertical = Math.sin((index + 1) * 311.7) * 17431.193;
  return {
    x: (horizontal - Math.floor(horizontal)) * 100,
    y: (vertical - Math.floor(vertical)) * 100,
    radius: index % 9 === 0 ? 1.4 : index % 3 === 0 ? 0.85 : 0.55,
    opacity: 0.16 + (index % 5) * 0.07,
  };
});

export function TurnModeGraphic() {
  const starGlowId = useId();
  const host = useRef<HTMLDivElement>(null);
  const detectionsOverlay = useRef<SVGSVGElement>(null);
  const detectionGroups = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const element = host.current;
    const overlay = detectionsOverlay.current;
    if (!element || !overlay || typeof ResizeObserver === "undefined") return;

    const callouts = detectionGroups.current.map((group) => ({
      group,
      leader: group?.querySelector(".turn-mode-leader"),
      label: group?.querySelector("text"),
    }));
    const labelWidths = callouts.map(
      ({ label }) => label?.getBBox().width ?? 140,
    );
    let width = 1;
    let height = 1;
    const resize = () => {
      width = Math.max(1, element.clientWidth);
      height = Math.max(1, element.clientHeight);
      overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const startedAt = performance.now();
    let animationFrame = 0;
    const draw = (now: number) => {
      const elapsed = reducedMotion.matches ? 0 : (now - startedAt) / 1000;
      const screenPositions = detections.map(({ position }, index) => ({
        x:
          position[0] * width +
          (reducedMotion.matches ? 0 : Math.sin(elapsed * 0.16 + index) * 3),
        y:
          position[1] * height +
          (reducedMotion.matches ? 0 : Math.cos(elapsed * 0.12 + index) * 2),
      }));
      const placedLabels: { x: number; y: number; width: number }[] = [];
      for (const [index, { x, y }] of screenPositions.entries()) {
        const { group, leader, label } = callouts[index];
        const [preferredX, preferredY] = detections[index].offset;
        const labelWidth = labelWidths[index];
        // Keep each callout beside its star and within the available field.
        const left =
          x < labelWidth + 70
            ? false
            : x > width - labelWidth - 70
              ? true
              : preferredX < 0;
        const direction = left ? -1 : 1;
        const labelX = Math.max(
          12,
          Math.min(
            width - labelWidth - 12,
            x + direction * 55 - (left ? labelWidth : 0),
          ),
        );
        const candidates = [0, -30, 30, -60, 60].map((shift) => {
          const labelY = Math.max(
            22,
            Math.min(height - 22, y + preferredY + shift),
          );
          const overlapsLabels = placedLabels.filter(
            (other) =>
              labelX < other.x + other.width + 8 &&
              labelX + labelWidth + 8 > other.x &&
              Math.abs(labelY - other.y) < 28,
          ).length;
          const overlapsStars = screenPositions.filter(
            (other) =>
              other.x + 19 > labelX &&
              other.x - 19 < labelX + labelWidth &&
              Math.abs(labelY - other.y) < 28,
          ).length;
          return { y: labelY, score: overlapsLabels * 10 + overlapsStars };
        });
        const best = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
        placedLabels.push({ x: labelX, y: best.y, width: labelWidth });
        const offsetX = labelX + (left ? labelWidth : 0) - x;
        const offsetY = best.y - y;
        group?.setAttribute("transform", `translate(${x} ${y})`);
        leader?.setAttribute(
          "d",
          `M${direction * 13} 0 H${direction * 25} L${offsetX - direction * 5} ${offsetY}`,
        );
        label?.setAttribute("transform", `translate(${offsetX} ${offsetY})`);
        label?.setAttribute("text-anchor", left ? "end" : "start");
      }

      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={host}
      className="turn-mode-graphic"
      role="img"
      aria-label="Four nearby stars scanned for Shadow Pawn presence"
    >
      <svg
        ref={detectionsOverlay}
        className="turn-mode-detections"
        viewBox="0 0 800 372"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={starGlowId}>
            <stop offset="0" stopColor="var(--bright)" stopOpacity="0.95" />
            <stop
              offset="0.12"
              stopColor="var(--foreground)"
              stopOpacity="0.7"
            />
            <stop
              offset="0.38"
              stopColor="var(--foreground)"
              stopOpacity="0.16"
            />
            <stop offset="1" stopColor="var(--foreground)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="turn-mode-background-stars">
          {backgroundStars.map((star, index) => (
            <circle
              key={index}
              cx={`${star.x}%`}
              cy={`${star.y}%`}
              r={star.radius}
              opacity={star.opacity}
              style={{ animationDelay: `${-index * 0.37}s` }}
            />
          ))}
        </g>
        <text className="turn-mode-field-label" x="20" y="26">
          NEARBY STARS
        </text>
        {detections.map((detection, index) => {
          const [offsetX, offsetY] = detection.offset;
          const left = offsetX < 0;
          const elbowX = left ? -25 : 25;
          const textX = offsetX + (left ? -5 : 5);
          const x = detection.position[0] * 800;
          const y = detection.position[1] * 372;
          return (
            <g
              key={detection.star}
              ref={(group) => {
                detectionGroups.current[index] = group;
              }}
              className="turn-mode-detection"
              data-present={detection.status.endsWith("PRESENT")}
              transform={`translate(${x} ${y})`}
            >
              <g
                className="turn-mode-star"
                transform={`scale(${detection.size})`}
                style={{ animationDelay: `${-index * 1.3}s` }}
              >
                <circle r="26" fill={`url(#${starGlowId})`} />
                <path
                  className="turn-mode-star-rays"
                  d="M-11 0 H11 M0 -11 V11"
                />
                <circle className="turn-mode-star-core" r="2.5" />
              </g>
              <rect x="-13" y="-13" width="26" height="26" />
              <path
                className="turn-mode-leader"
                d={`M${left ? -13 : 13} 0 H${elbowX} L${offsetX} ${offsetY}`}
              />
              <text
                transform={`translate(${textX} ${offsetY})`}
                y="-3"
                textAnchor={left ? "end" : "start"}
              >
                <tspan x="0">{detection.star}</tspan>
                <tspan x="0" dy="12">
                  {detection.status}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
