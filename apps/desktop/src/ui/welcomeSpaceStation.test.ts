import { Box3, LineSegments, Points } from "three";
import { expect, it, vi } from "vitest";
import { createWelcomeSpaceStation } from "./welcomeSpaceStation";

const palette = { foreground: "#fb923c", bright: "#fed7aa" };

it("keeps the Welcome station dormant and powers the same hull on Review", () => {
  const welcome = createWelcomeSpaceStation(palette);
  const review = createWelcomeSpaceStation(palette, { active: true });
  try {
    expect(welcome.group.getObjectByName("station-activity")).toBeUndefined();
    const activity = review.group.getObjectByName("station-activity");
    expect(activity).toBeDefined();
    expect(activity?.getObjectByName("habitat-lights")).toBeDefined();
    const craft = activity?.getObjectByName("docking-craft-0");
    expect(craft).toBeDefined();
    const start = craft!.position.clone();
    review.update(5);
    expect(craft!.position.distanceTo(start)).toBeGreaterThan(0.1);

    // The extra activity does not replace the original station geometry.
    for (let index = 0; index < 3; index += 1) {
      const activeHull = review.group.children[0].children[index];
      const dormantHull = welcome.group.children[0].children[index];
      if (
        !(activeHull instanceof LineSegments) ||
        !(dormantHull instanceof LineSegments)
      )
        throw new Error("Both stations must retain their wireframe hull");
      expect(activeHull.geometry.getAttribute("position").array).toEqual(
        dormantHull.geometry.getAttribute("position").array,
      );
    }
  } finally {
    welcome.dispose();
    review.dispose();
  }
});

it("keeps the station and its docking traffic within the Review field throughout a rotation", () => {
  const station = createWelcomeSpaceStation(palette, { active: true });
  const bounds = new Box3();
  try {
    for (let time = 0; time < 200; time += 1) {
      station.update(time);
      bounds.setFromObject(station.group, true);
      expect(bounds.min.x).toBeGreaterThan(-2.3);
      expect(bounds.max.x).toBeLessThan(2.3);
      expect(bounds.min.y).toBeGreaterThan(-2.85);
      expect(bounds.max.y).toBeLessThan(3.35);
    }
  } finally {
    station.dispose();
  }
});

it("updates the active station palette and releases every graphics resource", () => {
  const station = createWelcomeSpaceStation(palette, { active: true });
  const resources = new Set<{ dispose: () => void }>();
  station.group.traverse((object) => {
    if (object instanceof LineSegments || object instanceof Points) {
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        resources.add(material);
      }
    }
  });
  const disposal = [...resources].map((resource) =>
    vi.spyOn(resource, "dispose"),
  );
  station.setPalette({ foreground: "#9a4308", bright: "#612900" });
  const lights = station.group.getObjectByName("habitat-lights");
  expect(lights).toBeInstanceOf(Points);
  if (lights instanceof Points && !Array.isArray(lights.material)) {
    expect(lights.material.color.getHexString()).toBe("612900");
  }
  station.dispose();
  for (const dispose of disposal) expect(dispose).toHaveBeenCalledOnce();
});
