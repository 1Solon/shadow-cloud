import {
  Box3,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { createWelcomeSpaceStation } from "./welcomeSpaceStation";

type Palette = { foreground: string; background: string; bright: string };

const planetVertexShader = `
  varying vec3 vSurface;
  varying vec3 vNormal;

  void main() {
    vSurface = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const planetFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uBackground;
  uniform vec3 uBright;
  varying vec3 vSurface;
  varying vec3 vNormal;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(cell), hash(cell + vec3(1, 0, 0)), f.x),
          mix(hash(cell + vec3(0, 1, 0)), hash(cell + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(cell + vec3(0, 0, 1)), hash(cell + vec3(1, 0, 1)), f.x),
          mix(hash(cell + vec3(0, 1, 1)), hash(cell + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  float terrain(vec3 p) {
    return noise(p) * 0.53 + noise(p * 2.1) * 0.27
      + noise(p * 4.3) * 0.13 + noise(p * 8.7) * 0.07;
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 surface = normalize(vSurface);
    float elevation = terrain(surface * 4.8);
    float continents = smoothstep(0.42, 0.65, elevation);
    float ridges = 1.0 - abs(terrain(surface * 17.0) * 2.0 - 1.0);
    float daylight = smoothstep(-0.12, 0.85, dot(normal, normalize(vec3(-0.8, 0.5, 0.8))));
    float rim = pow(1.0 - max(normal.z, 0.0), 3.5);
    vec3 ground = mix(uColor * 0.13, uColor * 0.52, continents);
    ground += uColor * ridges * 0.065;
    vec3 color = mix(uBackground * 0.02, ground, 0.14 + daylight * 0.86);
    color += uBright * rim * (0.012 + daylight * 0.16);
    gl_FragColor = vec4(color, 0.96);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const glowVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uBright;
  varying vec2 vUv;

  void main() {
    float radius = length(vUv - 0.5) * 2.0;
    float sun = exp(-radius * radius * 13.0) * 0.32
      + (1.0 - smoothstep(0.13, 0.2, radius)) * 0.65;
    float alpha = sun * (1.0 - smoothstep(0.88, 1.0, radius));
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(mix(uColor, uBright, 0.7), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ORBIT_TILT = -0.24;
const ORBIT_FLATTENING = 0.46;

function orbitPosition(radius: number, angle: number) {
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius * ORBIT_FLATTENING;
  return new Vector3(
    x * Math.cos(ORBIT_TILT) - y * Math.sin(ORBIT_TILT),
    x * Math.sin(ORBIT_TILT) + y * Math.cos(ORBIT_TILT),
    0,
  );
}

export function createWelcomeSolarSystem(
  palette: Palette,
  {
    showStation = true,
    horizontalPosition = 0.48,
    centerSystem = false,
  }: {
    showStation?: boolean;
    horizontalPosition?: number;
    centerSystem?: boolean;
  } = {},
) {
  const group = new Group();
  const planetaryFrame = new Group();
  const system = new Group();
  planetaryFrame.add(system);
  group.add(planetaryFrame);

  const color = new Color(palette.foreground);
  const background = new Color(palette.background);
  const bright = new Color(palette.bright);
  const uniforms = {
    uColor: { value: color },
    uBackground: { value: background },
    uBright: { value: bright },
  };
  const geometries: BufferGeometry[] = [];
  const sphereGeometry = new SphereGeometry(1, 64, 32);
  const glowGeometry = new PlaneGeometry(2, 2);
  geometries.push(sphereGeometry, glowGeometry);

  const planetMaterial = new ShaderMaterial({
    vertexShader: planetVertexShader,
    fragmentShader: planetFragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sunMaterial = new ShaderMaterial({
    vertexShader: glowVertexShader,
    fragmentShader: glowFragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const orbitMaterial = new LineBasicMaterial({
    color,
    opacity: 0.16,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  for (const radius of [0.46, 0.82, 1.12, 1.5, 1.94]) {
    const geometry = new BufferGeometry().setFromPoints(
      Array.from({ length: 160 }, (_, index) =>
        orbitPosition(radius, (index / 160) * Math.PI * 2),
      ),
    );
    geometries.push(geometry);
    const orbit = new LineLoop(geometry, orbitMaterial);
    orbit.renderOrder = 1;
    system.add(orbit);
  }

  const sun = new Mesh(glowGeometry, sunMaterial);
  sun.scale.setScalar(0.2);
  sun.renderOrder = 2;
  system.add(sun);

  const station = createWelcomeSpaceStation(palette);
  station.group.name = "welcome-space-station";
  station.group.visible = showStation;
  group.add(station.group);
  const orbitingPlanets = [
    { radius: 0.46, phase: 2.1, size: 0.026, speed: 0.13 },
    { radius: 0.82, phase: 4.5, size: 0.046, speed: 0.075 },
    { radius: 1.12, phase: 1.3, size: 0.062, speed: 0.045 },
    { radius: 1.94, phase: 5.5, size: 0.052, speed: 0.022 },
  ].map((orbit) => {
    const body = new Mesh(sphereGeometry, planetMaterial);
    body.scale.setScalar(orbit.size);
    body.position.copy(orbitPosition(orbit.radius, orbit.phase));
    body.renderOrder = 4;
    system.add(body);
    return { ...orbit, body };
  });

  // Preserve the planetary framing independently of the station's placement.
  if (!centerSystem)
    system.position.copy(orbitPosition(1.5, 0.42)).multiplyScalar(-1);

  return {
    group,
    getStationEntryBounds(target: Box3) {
      return station.getEntryBounds(target);
    },
    getPlanetWorldPositions(targets: Vector3[]) {
      group.updateWorldMatrix(true, true);
      for (const [index, orbit] of orbitingPlanets.entries()) {
        if (targets[index]) orbit.body.getWorldPosition(targets[index]);
      }
      return targets;
    },
    resize(width: number, height: number) {
      // Frame the planets independently of the large, stationary wireframe.
      const scale = centerSystem
        ? Math.min(
            Math.max(1, width - 80) /
              (height *
                2 *
                Math.hypot(
                  Math.cos(ORBIT_TILT),
                  ORBIT_FLATTENING * Math.sin(ORBIT_TILT),
                )),
            Math.max(1, height - 80) /
              (height *
                2 *
                Math.hypot(
                  Math.sin(ORBIT_TILT),
                  ORBIT_FLATTENING * Math.cos(ORBIT_TILT),
                )),
          )
        : Math.min(0.66, (width / height) * 0.44);
      planetaryFrame.scale.set((height / width) * scale, scale, scale);
      planetaryFrame.position.set(
        horizontalPosition,
        centerSystem ? 0 : -0.05,
        0,
      );

      // Restore the station's original pre-orbit size and center-right placement.
      const stationScale = 0.3 * Math.min(1, width / 850);
      station.group.scale.set(
        (height / width) * stationScale,
        stationScale,
        stationScale,
      );
      station.group.position.set(
        width > 600 ? 0.48 : 0.43,
        width > 600 ? -0.05 : -0.32,
        0,
      );
    },
    update(time: number) {
      station.update(time);
      for (const orbit of orbitingPlanets) {
        orbit.body.position.copy(
          orbitPosition(orbit.radius, orbit.phase + time * orbit.speed),
        );
        orbit.body.rotation.y = time * 0.07;
      }
    },
    setPalette(next: Palette) {
      color.setStyle(next.foreground);
      background.setStyle(next.background);
      bright.setStyle(next.bright);
      orbitMaterial.color.copy(color);
      station.setPalette(next);
    },
    dispose() {
      station.dispose();
      for (const geometry of geometries) geometry.dispose();
      planetMaterial.dispose();
      sunMaterial.dispose();
      orbitMaterial.dispose();
    },
  };
}
