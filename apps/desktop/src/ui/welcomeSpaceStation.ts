import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from "three";
import { createSpaceStationActivity } from "./spaceStationActivity";

type Point = [number, number, number];
type Palette = { foreground: string; bright: string };

export function createWelcomeSpaceStation(
  palette: Palette,
  { active = false }: { active?: boolean } = {},
) {
  const outline: number[] = [];
  const detail: number[] = [];
  const damage: number[] = [];

  const line = (target: number[], from: Point, to: Point) => {
    target.push(...from, ...to);
  };
  const path = (target: number[], points: Point[], close = false) => {
    for (let index = 1; index < points.length; index += 1) {
      line(target, points[index - 1], points[index]);
    }
    if (close) line(target, points[points.length - 1], points[0]);
  };
  const radial = (radius: number, height: number, angle: number): Point => [
    Math.cos(angle) * radius,
    height,
    Math.sin(angle) * radius,
  ];

  const hull = (center: Point, profile: Array<[number, number]>, sides = 8) => {
    const sections = profile.map(([height, radius]) =>
      Array.from({ length: sides }, (_, index): Point => {
        const angle = (index / sides) * Math.PI * 2 + Math.PI / sides;
        return [
          center[0] + Math.cos(angle) * radius,
          center[1] + height,
          center[2] + Math.sin(angle) * radius,
        ];
      }),
    );
    for (const section of sections) path(outline, section, true);
    for (let level = 1; level < sections.length; level += 1) {
      for (let side = 0; side < sides; side += 1) {
        line(outline, sections[level - 1][side], sections[level][side]);
        if (level % 2 === 0) {
          line(
            detail,
            sections[level - 1][side],
            sections[level][(side + 1) % sides],
          );
        }
      }
    }
    return sections;
  };

  // A segmented vertical core, with an exposed break below the habitation deck.
  hull(
    [0, 0, 0],
    [
      [-0.48, 0.18],
      [-0.3, 0.28],
      [0.05, 0.28],
      [0.22, 0.2],
      [0.7, 0.2],
      [0.9, 0.31],
      [1.2, 0.31],
      [1.42, 0.19],
      [1.68, 0.12],
      [2.04, 0.045],
    ],
  );
  const lowerHull = hull(
    [0.06, 0, -0.035],
    [
      [-2.18, 0.055],
      [-1.94, 0.16],
      [-1.76, 0.23],
      [-1.58, 0.14],
      [-1.03, 0.14],
      [-0.84, 0.23],
      [-0.6, 0.18],
    ],
  );
  // Keep the transition target attached to the actual lower cone's vertices.
  const entryPoints = lowerHull
    .slice(0, 4)
    .flat()
    .map((point) => new Vector3(...point));
  const entryPoint = new Vector3();
  for (const angle of [0.3, 2.4, 4.2]) {
    path(damage, [
      radial(0.15, -0.46, angle),
      radial(0.12, -0.56, angle + 0.2),
      radial(0.18, -0.66, angle + 0.05),
    ]);
  }
  path(damage, [
    [-0.12, -0.48, 0.06],
    [-0.27, -0.61, 0.13],
    [-0.23, -0.73, 0.21],
  ]);

  const brokenRing = (
    height: number,
    radius: number,
    start: number,
    end: number,
    width: number,
  ) => {
    const count = Math.ceil(((end - start) / (Math.PI * 2)) * 44);
    const thickness = 0.065;
    const angleAt = (index: number) => start + ((end - start) * index) / count;
    const rails = [
      [radius - width, height - thickness],
      [radius + width, height - thickness],
      [radius + width, height + thickness],
      [radius - width, height + thickness],
    ];
    for (const [r, y] of rails) {
      path(
        outline,
        Array.from({ length: count + 1 }, (_, index) =>
          radial(r, y, angleAt(index)),
        ),
      );
    }
    for (let index = 0; index <= count; index += 1) {
      const angle = angleAt(index);
      path(
        detail,
        rails.map(([r, y]) => radial(r, y, angle)),
        true,
      );
      if (index < count) {
        line(
          detail,
          radial(radius - width, height + thickness, angle),
          radial(radius + width, height + thickness, angleAt(index + 1)),
        );
      }
    }
    for (const angle of [start, end]) {
      const direction = angle === start ? -1 : 1;
      path(damage, [
        radial(radius + width, height + thickness, angle),
        radial(radius + width * 0.6, height + 0.14, angle + direction * 0.07),
        radial(radius + width * 1.5, height + 0.05, angle + direction * 0.15),
      ]);
    }
    for (const fraction of [0.16, 0.4, 0.67, 0.9]) {
      const angle = start + (end - start) * fraction;
      line(
        outline,
        radial(0.22, height - 0.18, angle),
        radial(radius - width, height, angle),
      );
      line(
        detail,
        radial(0.2, height + 0.18, angle),
        radial(radius - width, height, angle),
      );
    }
  };
  brokenRing(0.22, 1.08, 0.52, 5.77, 0.08);
  brokenRing(1.04, 0.63, 1.3, 5.72, 0.06);

  // Asymmetric docking towers and outriggers replace the familiar solar wings.
  for (const [angle, height, radius] of [
    [2.8, 0.05, 1.05],
    [4.25, 0.64, 0.8],
    [1.5, -0.68, 0.61],
  ]) {
    const center = radial(radius, height, angle);
    path(outline, [
      radial(0.21, height + 0.2, angle),
      radial(radius * 0.65, height + 0.2, angle),
      center,
    ]);
    line(detail, radial(0.18, height - 0.26, angle), center);
    hull(
      center,
      [
        [-0.32, 0.065],
        [-0.22, 0.14],
        [0.17, 0.14],
        [0.28, 0.07],
      ],
      6,
    );
  }

  const radiatorFin = (angle: number, broken: boolean) => {
    const coordinates = broken
      ? [
          [0.16, -0.8],
          [0.76, -1.1],
          [0.92, -1.52],
          [0.67, -1.39],
          [0.71, -1.65],
          [0.33, -1.78],
          [0.18, -1.4],
        ]
      : [
          [0.16, -0.75],
          [0.91, -1.22],
          [1.13, -2.02],
          [0.34, -1.75],
          [0.18, -1.4],
        ];
    const front = coordinates.map(([r, y]) => radial(r, y, angle));
    const back = coordinates.map(([r, y]) => radial(r, y, angle + 0.055));
    path(outline, front, true);
    path(detail, back, true);
    for (let index = 0; index < front.length; index += 1) {
      line(detail, front[index], back[index]);
    }
    for (let index = 2; index < front.length - 1; index += 1) {
      line(detail, front[0], front[index]);
    }
    line(detail, front[1], front[front.length - 2]);
    if (broken) {
      path(damage, [
        front[2],
        radial(1.05, -1.64, angle + 0.06),
        radial(0.93, -1.74, angle + 0.1),
      ]);
    }
  };
  radiatorFin(0.35, true);
  radiatorFin(2.45, false);
  radiatorFin(4.6, false);

  // Forked sensor spires keep the silhouette tall through a full rotation.
  for (const [index, angle] of [0.2, 2.3, 4.4].entries()) {
    const tip = index === 1 ? 2.12 : 2.53;
    const crown = [
      radial(0.2, 1.4, angle),
      radial(0.45, 1.87, angle),
      radial(0.34, tip, angle),
      radial(0.27, 1.87, angle),
    ];
    path(outline, crown, true);
    line(detail, crown[0], crown[2]);
    if (index === 1) {
      path(damage, [
        crown[2],
        radial(0.45, 2.21, angle + 0.1),
        radial(0.42, 2.34, angle + 0.16),
      ]);
    }
  }
  line(outline, [0, 1.93, 0], [0, 2.67, 0]);
  line(detail, [0.02, 2.08, 0.02], [0.12, 2.38, 0.04]);

  // A displaced ring segment and hull splinter float beside the fractured edges.
  path(
    damage,
    [
      [1.21, 0.33, 0.08],
      [1.43, 0.41, 0.28],
      [1.44, 0.26, 0.32],
      [1.23, 0.18, 0.11],
    ],
    true,
  );
  line(detail, [1.21, 0.33, 0.08], [1.44, 0.26, 0.32]);
  path(
    damage,
    [
      [0.93, -1.83, 0.57],
      [1.06, -2.07, 0.62],
      [0.85, -2.01, 0.51],
    ],
    true,
  );

  const group = new Group();
  const station = new Group();
  group.add(station);
  const layers = [
    {
      positions: detail,
      color: palette.foreground,
      opacity: active ? 0.6 : 0.46,
    },
    { positions: outline, color: palette.bright, opacity: active ? 1 : 0.88 },
    { positions: damage, color: palette.foreground, opacity: 0.78 },
  ].map(({ positions, color, opacity }) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new LineSegments(geometry, material);
    lines.renderOrder = 4;
    station.add(lines);
    return { geometry, material };
  });
  station.rotation.set(0.3, -0.38, -Math.PI / 18, "ZXY");
  const activity = active ? createSpaceStationActivity(palette) : null;
  if (activity) station.add(activity.group);

  return {
    group,
    getEntryBounds(target: Box3) {
      station.updateWorldMatrix(true, false);
      target.makeEmpty();
      for (const point of entryPoints) {
        target.expandByPoint(
          entryPoint.copy(point).applyMatrix4(station.matrixWorld),
        );
      }
      return target;
    },
    update(time: number) {
      // Spin around the tilted spine, keeping the rightward lean steady.
      station.rotation.y = -0.38 + time * (active ? 0.065 : 0.025);
      activity?.update(time);
    },
    setPalette(next: Palette) {
      layers[0].material.color.setStyle(next.foreground);
      layers[1].material.color.setStyle(next.bright);
      layers[2].material.color.setStyle(next.foreground);
      activity?.setPalette(next);
    },
    dispose() {
      activity?.dispose();
      for (const { geometry, material } of layers) {
        geometry.dispose();
        material.dispose();
      }
    },
  };
}
