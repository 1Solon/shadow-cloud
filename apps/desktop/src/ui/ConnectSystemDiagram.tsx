import { useId } from "react";

const reserve = 0.08;
const reservoirHeight = 172;
const surface = reservoirHeight * (1 - reserve);
const feed = "M316 414 H350 V340 H378 M402 340 H498";
const output = "M674 340 H749";

function apertureArc(radius: number, start: number) {
  const from = (start * Math.PI) / 180;
  const to = ((start + 68) * Math.PI) / 180;
  return `M${586 + Math.cos(from) * radius} ${340 + Math.sin(from) * radius} A${radius} ${radius} 0 0 1 ${586 + Math.cos(to) * radius} ${340 + Math.sin(to) * radius}`;
}

// A stable, diffuse swarm: no random re-layout when authentication changes.
const nanoParticles = Array.from({ length: 64 }, (_, i) => {
  const angle = i * 2.399963229728653;
  const radius = Math.sqrt((i + 0.5) / 64);
  return {
    x: 794 + Math.cos(angle) * radius * 52,
    y: 340 + Math.sin(angle) * radius * 37 + Math.sin(angle * 2) * 3,
    size: i % 11 === 0 ? 4.2 : i % 4 === 0 ? 2.8 : i % 3 === 0 ? 1.8 : 1.2,
    opacity: 0.35 + (i % 6) * 0.12,
  };
});
const nanoLinks = nanoParticles.flatMap((point, i) => {
  if (i % 2) return [];
  const neighbor = nanoParticles
    .slice(i + 1)
    .find((other) => Math.hypot(point.x - other.x, point.y - other.y) < 17);
  return neighbor
    ? [`M${point.x} ${point.y} L${neighbor.x} ${neighbor.y}`]
    : [];
});

/** A decorative system schematic, not instrumentation or an authentication port. */
export function ConnectSystemDiagram({ connected }: { connected: boolean }) {
  const id = useId();
  const clip = `${id}-reserve`;
  const liquid = `${id}-liquid`;
  return (
    <svg
      className="connect-system"
      viewBox="80 220 720 285"
      preserveAspectRatio="xMidYMin meet"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="142" height={reservoirHeight} />
        </clipPath>
        <linearGradient id={liquid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="connect-system-liquid-light" />
          <stop offset="1" className="connect-system-liquid-shade" />
        </linearGradient>
      </defs>

      <g className="connect-system-layout" transform="translate(-60 0)">
        <g className="connect-system-guides">
          <path d="M150 266 V242 H174 M800 242 H824 V266 M150 430 V454 H174 M800 454 H824 V430" />
        </g>

        <g transform="translate(174 256)" data-reserve={reserve}>
          <text y="-12" className="connect-system-label">
            LIQUID ENERGY
          </text>
          <rect
            width="142"
            height={reservoirHeight}
            className="connect-system-outline"
          />
          <g className="connect-system-ticks">
            {[0, 43, 86, 129, 172].map((y) => (
              <path key={y} d={`M-14 ${y} h9`} />
            ))}
          </g>
          <g clipPath={`url(#${clip})`}>
            <path
              className="connect-system-liquid"
              fill={`url(#${liquid})`}
              stroke="var(--bright)"
              strokeWidth="1"
              d={`M-142 ${surface} q35.5 -4 71 0 t71 0 t71 0 t71 0 t71 0 t71 0 V180 H-142 Z`}
            />
          </g>
          <path
            d={`M148 ${surface} h10`}
            className="connect-system-liquid-marker"
          />
        </g>

        <g className="connect-system-conduit">
          <path d={feed} />
          <path d={output} />
          <circle cx="316" cy="414" r="3" />
          <circle cx="498" cy="340" r="3" />
          <circle cx="674" cy="340" r="3" />
          <path d="M439 335 L445 340 L439 345 M726 335 L732 340 L726 345" />
        </g>
        <g className="connect-system-powered">
          <path d={feed} className="connect-system-signal" />
          <path d={output} className="connect-system-signal" />
        </g>

        <g className="connect-system-gate">
          <circle cx="390" cy="340" r="23" className="connect-system-guides" />
          <circle cx="379" cy="340" r="2" />
          <circle cx="401" cy="340" r="2" />
          <path d={connected ? "M379 340 H401" : "M379 340 L399 326"} />
        </g>

        <g className="connect-system-qtt">
          <text
            x="586"
            y="244"
            textAnchor="middle"
            className="connect-system-title"
          >
            QTT
          </text>
          <g className="connect-system-aperture">
            {[88, 76].flatMap((radius) =>
              [101, 191, 281].map((start) => (
                <path
                  key={`${radius}-${start}`}
                  d={apertureArc(radius, start)}
                />
              )),
            )}
            <path d="M519 285 L528 293 M644 293 L653 285 M519 395 L528 387" />
          </g>
          <g className="connect-system-damage">
            <path d="M672 357 A88 88 0 0 1 664 380 L659 380 L662 386 M661 355 A76 76 0 0 1 654 375 L650 375 L652 380" />
            <path d="M631 413 L626 413 L628 418 A88 88 0 0 1 603 426 M623 401 L619 402 L621 408 A76 76 0 0 1 600 415" />
            <path
              d="M657 390 L664 400 L661 406 L654 400 L650 395 Z"
              className="connect-system-fragment"
            />
            <path d="M640 390 L646 397 M636 406 L639 410 M654 413 L658 417 M666 389 L670 392" />
          </g>
          <g className="connect-system-resonator">
            <path d="M557 294 A54 54 0 0 0 557 386 M615 294 A54 54 0 0 1 615 386" />
            <path d="M498 340 H552 M620 340 H674" />
            <path d="M586 264 V278 M586 402 V416" />
          </g>
          <path
            d="M586 318 L608 340 L586 362 L564 340 Z"
            className="connect-system-core"
          />
          <g className="connect-system-powered">
            <path
              d="M586 333 L593 340 L586 347 L579 340 Z"
              className="connect-system-core-light"
            />
            <circle cx="586" cy="340" r="35" className="connect-system-pulse" />
          </g>
        </g>

        <g className="connect-system-cloud">
          <text
            x="794"
            y="284"
            textAnchor="middle"
            className="connect-system-label"
          >
            Shadow
          </text>
          <g className="connect-system-nano-links">
            <path d="M749 340 L767 326 M749 340 L770 354" />
            {nanoLinks.map((path) => (
              <path key={path} d={path} />
            ))}
          </g>
          {nanoParticles.map(({ x, y, size, opacity }, i) => (
            <g
              key={i}
              className="connect-system-nano-drift"
              style={{
                animationDelay: `${-i * 0.73}s`,
                animationDuration: `${7 + (i % 5)}s`,
              }}
            >
              <rect
                className={`connect-system-nano-particle${i % 11 === 0 ? " connect-system-nano-particle--hollow" : ""}`}
                x={x - size / 2}
                y={y - size / 2}
                width={size}
                height={size}
                opacity={opacity}
                transform={i % 3 === 0 ? `rotate(45 ${x} ${y})` : undefined}
              />
            </g>
          ))}
        </g>
        <g className="connect-system-warning connect-system-warning--energy">
          <circle cx="242" cy="420" r="3" />
          <path d="M242 420 L218 467 H174" />
          <text x="174" y="492">
            Warning: Low LE, Refuel Needed!
          </text>
        </g>
        <g className="connect-system-warning connect-system-warning--maintenance">
          <circle cx="650" cy="400" r="3" />
          <path d="M650 400 L688 456 V469 H446" />
          <text x="446" y="492">
            Warning: Maintenance window exceeded by NaN!
          </text>
        </g>
      </g>
    </svg>
  );
}
