import { useEffect, useRef, useState } from "react";

const rejectedPods = [
  {
    id: "CR-042",
    reason: "SHADOW PRESENCE NOT DETECTED",
    damage: 1,
  },
  {
    id: "CR-119",
    reason: "IDENTITY CHECK FAILED // NEURAL PATTERN CORRUPTED",
    damage: 3,
  },
  {
    id: "CR-207",
    reason: "CRYO CYCLE EXPIRED // NaN OVER LIMIT",
    damage: 2,
  },
  {
    id: "CR-318",
    reason: "VITALS NOMINAL // LORD RESONANCE ABSENT",
    damage: 4,
  },
] as const;

type CyclePhase = "advancing" | "scanning" | "reporting";
type DamageLevel = 0 | 1 | 2 | 3 | 4;

export const ROOT_RELEASE_DURATION_MS = 1800;

const podDamage = [
  ["M27 69 L35 61 L42 64", "M93 181 L86 174 L90 166"],
  ["M37 105 L44 113 L40 121 L49 129", "M103 82 L96 91 L101 99"],
  [
    "M104 57 L94 68 L101 78 L91 90",
    "M93 151 L84 143 L88 134 L78 125",
    "M111 93 L120 87 L117 103 L125 109",
  ],
  [
    "M47 48 L53 58 L61 52 L68 65",
    "M36 89 L48 99 L43 109 L54 118 L48 131",
    "M25 190 L36 181 L32 171",
  ],
  [
    "M16 119 L27 126 L22 137 L34 146 L27 158",
    "M89 82 L81 94 L87 103 L76 115 L82 126",
    "M101 203 L90 195 L94 184",
  ],
] as const;

function CryoPod({
  x,
  id,
  damage,
}: {
  x: number;
  id: string;
  damage: DamageLevel;
}) {
  const broken = damage >= 2;
  return (
    <g
      className={`cryo-pod${broken ? " cryo-pod--broken" : ""}`}
      data-damage={damage}
      transform={`translate(${x} 0)`}
    >
      <path
        className="cryo-pod-shell"
        d="M16 72 L31 48 H99 L114 72 V210 L99 234 H31 L16 210 Z"
      />
      <path
        className="cryo-pod-window"
        d="M35 82 Q65 62 95 82 V174 Q65 194 35 174 Z"
      />
      <path
        className="cryo-pod-detail"
        d="M16 102 H4 V184 H16 M114 102 H126 V184 H114 M31 48 V35 H99 V48 M31 234 V247 H99 V234"
      />
      <g className="cryo-pod-occupant">
        <circle cx="65" cy="108" r="7" />
        <path d="M65 115 V146 M48 127 L65 120 L82 127 M65 146 L52 167 M65 146 L78 167" />
      </g>
      <g className="cryo-pod-damage">
        {podDamage[damage].map((path, index) => (
          <path key={path} d={path} data-fragment={index === 2 || undefined} />
        ))}
      </g>
      <text x="65" y="222" textAnchor="middle">
        {id}
      </text>
    </g>
  );
}

export function RootGraphic({
  displayName,
  selected,
}: {
  displayName: string | null;
  selected: boolean;
}) {
  const [candidate, setCandidate] = useState(0);
  const [phase, setPhase] = useState<"cycling" | "releasing" | "complete">(
    selected ? "complete" : "cycling",
  );
  const [cyclePhase, setCyclePhase] = useState<CyclePhase>("advancing");
  const [suspended, setSuspended] = useState(false);
  const previouslySelected = useRef(selected);

  useEffect(() => {
    const visibilityChanged = () => setSuspended(document.hidden);
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
  }, []);

  useEffect(() => {
    if (selected) {
      if (previouslySelected.current) {
        setPhase("complete");
        return;
      }
      previouslySelected.current = true;
      setPhase("releasing");
      const timeout = window.setTimeout(
        () => setPhase("complete"),
        ROOT_RELEASE_DURATION_MS,
      );
      return () => window.clearTimeout(timeout);
    }
    if (previouslySelected.current) {
      previouslySelected.current = false;
      setCandidate(0);
      setCyclePhase("advancing");
      setPhase("cycling");
      return;
    }
    setPhase("cycling");
    if (suspended) return;
    const duration =
      cyclePhase === "advancing" ? 800 : cyclePhase === "scanning" ? 850 : 1500;
    const timeout = window.setTimeout(() => {
      if (cyclePhase === "advancing") setCyclePhase("scanning");
      else if (cyclePhase === "scanning") setCyclePhase("reporting");
      else {
        setCandidate((current) => (current + 1) % rejectedPods.length);
        setCyclePhase("advancing");
      }
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [cyclePhase, selected, suspended]);

  const name = displayName?.trim() || "UNKNOWN LORD";
  const rejected = rejectedPods[candidate];

  return (
    <div
      className="root-graphic"
      data-phase={phase}
      data-cycle-phase={selected ? undefined : cyclePhase}
      data-suspended={suspended}
      role="group"
      aria-label={
        selected
          ? `${name} selected; Shadow Lord presence confirmed`
          : cyclePhase === "reporting"
            ? `Cryo pod ${rejected.id} rejected: ${rejected.reason}`
            : `${cyclePhase === "advancing" ? "Advancing" : "Scanning"} cryo pod ${rejected.id}`
      }
    >
      <div className="cryo-schematic" aria-hidden="true">
        <svg viewBox="0 0 760 280" preserveAspectRatio="xMidYMid meet">
          <g className="cryo-guides">
            <path d="M8 22 H752 M8 258 H752 M20 12 V32 M740 12 V32 M20 248 V268 M740 248 V268" />
            <path d="M0 248 H760" />
          </g>
          <g className="cryo-rail">
            <path d="M0 238 H760" />
            {Array.from({ length: 20 }, (_, index) => (
              <path key={index} d={`M${index * 40} 238 v12`} />
            ))}
          </g>
          <g className="cryo-scanner">
            <path
              className="cryo-scan-cone"
              d="M313 14 L270 226 H376 L333 14 Z"
            />
            <path
              className="cryo-scanner-shell"
              data-damage="25"
              d="M310 -4 H350 V14 H310 L306 10 L311 6 L305 2 Z"
            />
            <path
              className="cryo-scanner-emitters"
              d="M313 8 H318 L317 14 H314 Z M321 8 H326 L325 14 H322 Z M329 8 H334 L333 14 H330 Z"
            />
          </g>
          <g className="cryo-scanner-callout">
            <circle cx="350" cy="4" r="2" />
            <path d="M350 4 H456" />
            <text x="464" y="4" dominantBaseline="hanging">
              SCANNER (ORGANIC)
            </text>
          </g>

          {selected ? (
            <g className="cryo-selected-pod">
              <CryoPod x={258} id={rejected.id} damage={0} />
              <g className="cryo-occupant-release">
                <circle cx="323" cy="128" r="10" />
                <path d="M323 140 V176 M305 151 L323 144 L341 151 M323 176 L308 204 M323 176 L338 204" />
              </g>
            </g>
          ) : (
            <g className="cryo-pod-track">
              {[-122, 68, 258, 448, 638].map((x, index) => {
                const pod =
                  rejectedPods[
                    (candidate + index - 2 + rejectedPods.length) %
                      rejectedPods.length
                  ];
                return (
                  <CryoPod key={x} x={x} damage={pod.damage} id={pod.id} />
                );
              })}
            </g>
          )}
        </svg>
      </div>

      <div className="cryo-terminal" aria-live="polite">
        <div className="cryo-terminal-lines">
          {selected ? (
            <>
              <span>{`> SCAN ${rejected.id}`}</span>
              <span>IDENTITY: {name}</span>
              <span>VITALS: STABLE</span>
              <span>SHADOW LORD PRESENCE: CONFIRMED</span>
              <strong>
                {phase === "complete"
                  ? "[OK] OCCUPANT RELEASED"
                  : "[OK] VIABLE // RELEASING OCCUPANT"}
              </strong>
            </>
          ) : cyclePhase === "advancing" ? (
            <>
              <span>{"> LOAD NEXT POD"}</span>
              <span>CONVEYOR: ADVANCING</span>
              <strong>[STANDBY] ALIGNING SCAN CHAMBER</strong>
            </>
          ) : cyclePhase === "scanning" ? (
            <>
              <span>{`> SCAN ${rejected.id}`}</span>
              <span>SCANNER (ORGANIC): IN PROGRESS</span>
              <strong>[HOLD] POD LOCKED</strong>
            </>
          ) : (
            <>
              <span>{`> SCAN ${rejected.id}`}</span>
              <span>VITALS: DETECTED</span>
              <span>{rejected.reason}</span>
              <strong>[REJECTED] ADVANCE NEXT POD</strong>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
