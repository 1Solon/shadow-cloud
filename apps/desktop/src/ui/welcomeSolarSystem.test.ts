import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createWelcomeSolarSystem } from "./welcomeSolarSystem";

const palette = {
  foreground: "#fb923c",
  background: "#050403",
  bright: "#fed7aa",
};

function getStation(solarSystem: ReturnType<typeof createWelcomeSolarSystem>) {
  const station = solarSystem.group.getObjectByName("welcome-space-station");
  if (!station) throw new Error("The station must be part of the solar system");
  return station;
}

describe("welcome station placement", () => {
  it("can reuse the orbiting planets without showing the station", () => {
    const solarSystem = createWelcomeSolarSystem(palette, {
      showStation: false,
      horizontalPosition: 0,
      centerSystem: true,
    });
    const positions = Array.from({ length: 4 }, () => new Vector3());
    try {
      expect(getStation(solarSystem).visible).toBe(false);
      solarSystem.resize(760, 280);
      solarSystem.update(0);
      solarSystem.getPlanetWorldPositions(positions);
      expect(positions.every((position) => position.length() > 0)).toBe(true);
    } finally {
      solarSystem.dispose();
    }
  });

  it("restores the original large center-right station and keeps it spinning in place", () => {
    const solarSystem = createWelcomeSolarSystem(palette);
    const position = new Vector3();
    try {
      const station = getStation(solarSystem);
      solarSystem.resize(883, 594);
      station.getWorldPosition(position);
      const start = position.clone();
      expect(start.x).toBeCloseTo(0.48);
      expect(start.y).toBeCloseTo(-0.05);
      const bounds = new Box3().setFromObject(station, true);
      const pixelHeight = ((bounds.max.y - bounds.min.y) * 594) / 2;
      expect(pixelHeight).toBeGreaterThan(415);
      expect(pixelHeight).toBeLessThan(445);
      const initialRotation = station.children[0].quaternion.clone();

      solarSystem.update(60);
      station.getWorldPosition(position);
      expect(position.distanceTo(start)).toBeLessThan(1e-10);
      expect(
        initialRotation.angleTo(station.children[0].quaternion),
      ).toBeGreaterThan(0.1);

      solarSystem.resize(1089, 641);
      station.getWorldPosition(position);
      expect(position.distanceTo(start)).toBeLessThan(1e-10);

      solarSystem.resize(883, 594);
      station.getWorldPosition(position);
      expect(position.distanceTo(start)).toBeLessThan(1e-10);

      solarSystem.update(0);
      station.getWorldPosition(position);
      expect(position.distanceTo(start)).toBeLessThan(1e-10);
    } finally {
      solarSystem.dispose();
    }
  });

  it.each([
    [883, 594],
    [1089, 641],
    [589, 450],
    [600, 900],
  ])(
    "keeps the large station visible with a steady rightward lean in the %i × %i field",
    (width, height) => {
      const solarSystem = createWelcomeSolarSystem(palette);
      const bounds = new Box3();
      try {
        const station = getStation(solarSystem);
        solarSystem.resize(width, height);
        solarSystem.group.updateMatrixWorld(true);

        for (let elapsed = 0; elapsed <= 600; elapsed += 4) {
          solarSystem.update(elapsed);
          solarSystem.group.updateMatrixWorld(true);
          const hull = station.children[0];
          const origin = hull.localToWorld(new Vector3());
          const tip = hull.localToWorld(new Vector3(0, 1, 0));
          const lean = Math.atan2(
            (tip.x - origin.x) * width,
            (tip.y - origin.y) * height,
          );
          expect(lean).toBeGreaterThan((5 * Math.PI) / 180);
          expect(lean).toBeLessThan((15 * Math.PI) / 180);
          bounds.setFromObject(station, true);
          const entry = solarSystem.getStationEntryBounds(new Box3());
          expect(bounds.containsBox(entry)).toBe(true);
          expect(entry.max.y).toBeLessThan(station.position.y);
          expect(entry.max.x - entry.min.x).toBeLessThan(
            (bounds.max.x - bounds.min.x) * 0.4,
          );
          expect(entry.max.y - entry.min.y).toBeLessThan(
            (bounds.max.y - bounds.min.y) * 0.25,
          );
          expect(bounds.min.x).toBeGreaterThanOrEqual(-1);
          expect(bounds.max.x).toBeLessThanOrEqual(1);
          expect(bounds.min.y).toBeGreaterThanOrEqual(-1);
          expect(bounds.max.y).toBeLessThanOrEqual(1);
          const relativeHeight = (bounds.max.y - bounds.min.y) / 2;
          expect(relativeHeight).toBeGreaterThan(0.45);
          expect(relativeHeight).toBeLessThan(0.75);
        }
      } finally {
        solarSystem.dispose();
      }
    },
  );
});
