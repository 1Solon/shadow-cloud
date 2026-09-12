import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
} from "three";

type Palette = { foreground: string; bright: string };

/** Decorative station activity; independent of the Companion's transfer state. */
export function createSpaceStationActivity(palette: Palette) {
  const group = new Group();
  group.name = "station-activity";
  const geometries: BufferGeometry[] = [];
  const materials: Array<LineBasicMaterial | PointsMaterial> = [];
  const geometry = (positions: number[]) => {
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometries.push(result);
    return result;
  };
  const radial = (radius: number, height: number, angle: number) =>
    new Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  const pointLights = (name: string, positions: number[], size: number) => {
    const material = new PointsMaterial({
      color: palette.bright,
      size,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(material);
    const lights = new Points(geometry(positions), material);
    lights.name = name;
    lights.renderOrder = 6;
    group.add(lights);
    return lights;
  };

  const windows: number[] = [];
  for (const height of [0.96, 1.09, 1.19]) {
    for (let index = 0; index < 12; index += 1) {
      windows.push(
        ...radial(0.315, height, (index / 12) * Math.PI * 2).toArray(),
      );
    }
  }
  for (let index = 0; index < 32; index += 1) {
    windows.push(...radial(1.16, 0.23, 0.6 + (index / 31) * 5.1).toArray());
  }
  const habitat = pointLights("habitat-lights", windows, 2.3);
  const beacons = pointLights(
    "docking-beacons",
    [
      0,
      2.67,
      0,
      ...radial(1.05, 0.33, 2.8).toArray(),
      ...radial(0.8, 0.92, 4.25).toArray(),
      ...radial(0.61, -0.4, 1.5).toArray(),
    ],
    4,
  );

  // Small courier silhouettes approach and leave the existing docking towers.
  const craftGeometry = geometry([
    0, 0.13, 0, -0.045, -0.06, 0, -0.045, -0.06, 0, 0.045, -0.06, 0, 0.045,
    -0.06, 0, 0, 0.13, 0, -0.045, -0.03, 0, -0.12, -0.08, 0, -0.12, -0.08, 0,
    0.12, -0.08, 0, 0.12, -0.08, 0, 0.045, -0.03, 0, 0, -0.08, 0, 0, -0.22, 0,
  ]);
  const routes = [
    { start: new Vector3(-2.05, -0.2, 0.25), dock: radial(1.05, 0.05, 2.8) },
    { start: new Vector3(1.85, -1.45, 0.2), dock: radial(0.61, -0.68, 1.5) },
    { start: new Vector3(1.6, 1.7, -0.5), dock: radial(0.8, 0.64, 4.25) },
  ];
  const traffic = routes.map(({ start, dock }, index) => {
    const material = new LineBasicMaterial({
      color: palette.bright,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(material);
    const craft = new LineSegments(craftGeometry, material);
    craft.name = `docking-craft-${index}`;
    craft.renderOrder = 6;
    const departure = index === 1;
    const from = departure ? dock : start;
    const to = departure ? start : dock;
    craft.quaternion.setFromUnitVectors(
      new Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    group.add(craft);
    return { craft, material, from, to };
  });

  const update = (time: number) => {
    habitat.material.opacity = 0.82 + Math.sin(time * 0.8) * 0.12;
    beacons.material.opacity = 0.55 + (Math.sin(time * 2.2) + 1) * 0.225;
    for (const [index, { craft, material, from, to }] of traffic.entries()) {
      const progress = (time / (15 + index * 3) + 0.18 + index * 0.29) % 1;
      const approach = progress * progress * (3 - 2 * progress);
      craft.position.lerpVectors(from, to, approach);
      material.opacity = Math.min(1, Math.sin(progress * Math.PI) * 2);
    }
  };
  update(0);

  return {
    group,
    update,
    setPalette(next: Palette) {
      for (const material of materials) material.color.setStyle(next.bright);
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
