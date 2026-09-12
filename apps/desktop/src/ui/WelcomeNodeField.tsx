import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { createWelcomeSolarSystem } from "./welcomeSolarSystem";
import {
  sampleWelcomeSetupTransition,
  WELCOME_SETUP_DURATION_MS,
} from "./welcomeSetupTransition";

const DEFAULT_NODE_COUNT = 285;
const DEFAULT_SEED = 0x53434c44;

export type NodeFieldData = {
  positions: number[];
  sizes: number[];
  opacities: number[];
  phases: number[];
  motion: number[];
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNodeFieldData(
  count = DEFAULT_NODE_COUNT,
  seed = DEFAULT_SEED,
): NodeFieldData {
  const random = seededRandom(seed);
  const positions: number[] = [];
  const sizes: number[] = [];
  const opacities: number[] = [];
  const phases: number[] = [];
  const motion: number[] = [];

  for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
    const horizontalPosition = random();
    const depth = random();

    positions.push(horizontalPosition * 2 - 1, random() * 2 - 1, depth * 2 - 1);
    sizes.push(1.5 + depth ** 2 * 7 + random() * 3.5);
    opacities.push(
      (0.12 + depth * 0.3 + random() ** 2 * 0.55) *
        (0.65 + horizontalPosition * 0.35),
    );
    phases.push(random() * Math.PI * 2);
    motion.push(0.35 + random() * 0.65);
  }

  return { positions, sizes, opacities, phases, motion };
}

const vertexShader = `
  attribute float aSize;
  attribute float aOpacity;
  attribute float aPhase;
  attribute float aMotion;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vOpacity;

  void main() {
    vec3 animatedPosition = position;
    animatedPosition.x += sin(uTime * (2.56 + aMotion * 1.44) + aPhase) * 0.008 * aMotion;
    animatedPosition.y += cos(uTime * (2.08 + aMotion * 1.20) + aPhase * 1.37) * 0.011 * aMotion;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(animatedPosition, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    vOpacity = aOpacity;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vOpacity;

  void main() {
    float radius = distance(gl_PointCoord, vec2(0.5));
    float halo = 1.0 - smoothstep(0.16, 0.5, radius);
    float core = 1.0 - smoothstep(0.0, 0.14, radius);
    float shape = max(halo * 0.55, core);

    if (shape <= 0.0) discard;
    gl_FragColor = vec4(uColor, vOpacity * shape * uOpacity);
  }
`;

export type WelcomeNodeFieldHandle = {
  beginSetup: () => Promise<boolean>;
  reset: () => void;
};

const skipTransition: WelcomeNodeFieldHandle = {
  beginSetup: async () => true,
  reset: () => {},
};

export function WelcomeNodeField({
  ref,
}: {
  ref?: Ref<WelcomeNodeFieldHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const targetFrame = useRef<SVGRectElement>(null);
  const controls = useRef<WelcomeNodeFieldHandle>(skipTransition);
  useImperativeHandle(
    ref,
    () => ({
      beginSetup: () => controls.current.beginSetup(),
      reset: () => controls.current.reset(),
    }),
    [],
  );

  useEffect(() => {
    const element = host.current;
    const frame = targetFrame.current;
    if (
      !element ||
      !frame ||
      (typeof window.WebGLRenderingContext === "undefined" &&
        typeof window.WebGL2RenderingContext === "undefined")
    )
      return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    const data = createNodeFieldData();
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, -2, 2);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(data.positions, 3),
    );
    geometry.setAttribute("aSize", new Float32BufferAttribute(data.sizes, 1));
    geometry.setAttribute(
      "aOpacity",
      new Float32BufferAttribute(data.opacities, 1),
    );
    geometry.setAttribute("aPhase", new Float32BufferAttribute(data.phases, 1));
    geometry.setAttribute(
      "aMotion",
      new Float32BufferAttribute(data.motion, 1),
    );

    const readPalette = () => {
      const style = getComputedStyle(element);
      return {
        foreground: style.getPropertyValue("--foreground").trim() || "#fb923c",
        background: style.getPropertyValue("--card").trim() || "#050403",
        bright: style.getPropertyValue("--bright").trim() || "#fed7aa",
      };
    };
    const palette = readPalette();
    const material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fragmentShader,
      transparent: true,
      uniforms: {
        uColor: { value: new Color(palette.foreground) },
        uOpacity: { value: 0.35 },
        uPixelRatio: {
          value: Math.min(window.devicePixelRatio, 1.75),
        },
        uTime: { value: 0 },
      },
      vertexShader,
    });
    const points = new Points(geometry, material);
    scene.add(points);
    const solarSystem = createWelcomeSolarSystem(palette);
    scene.add(solarSystem.group);

    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.appendChild(renderer.domElement);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let webglAvailable = true;
    let transition: {
      startedAt: number;
      finished: boolean;
      promise: Promise<boolean>;
      resolve: (completed: boolean) => void;
      timeout: number;
    } | null = null;
    const target = new Box3();
    const targetCenter = new Vector3();
    const targetSize = new Vector3();
    const projectedMin = new Vector3();
    const projectedMax = new Vector3();

    const render = () => {
      if (webglAvailable) renderer.render(scene, camera);
    };
    const finishTransition = () => {
      if (!transition || transition.finished) return;
      transition.finished = true;
      window.clearTimeout(transition.timeout);
      element.style.opacity = "0";
      transition.resolve(true);
    };
    const applyTransition = (time: number) => {
      if (!transition || transition.finished) return;
      const width = Math.max(element.clientWidth, 1);
      const height = Math.max(element.clientHeight, 1);
      const progress = sampleWelcomeSetupTransition(
        time - transition.startedAt,
      );
      solarSystem.getStationEntryBounds(target);
      target.expandByVector(new Vector3(16 / width, 16 / height, 0));
      target.getCenter(targetCenter);
      target.getSize(targetSize);
      const finalZoom = Math.min(
        16,
        1.65 / Math.max(targetSize.x, targetSize.y),
      );
      camera.zoom = 1 + (finalZoom - 1) * progress.zoomProgress;
      // Move the cone smoothly toward the center without swinging offscreen mid-zoom.
      const pan = 1 - (1 - progress.zoomProgress) / camera.zoom;
      camera.position.set(targetCenter.x * pan, targetCenter.y * pan, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      projectedMin.copy(target.min).project(camera);
      projectedMax.copy(target.max).project(camera);
      frame.setAttribute("x", String(((projectedMin.x + 1) * width) / 2));
      frame.setAttribute("y", String(((1 - projectedMax.y) * height) / 2));
      frame.setAttribute(
        "width",
        String(((projectedMax.x - projectedMin.x) * width) / 2),
      );
      frame.setAttribute(
        "height",
        String(((projectedMax.y - projectedMin.y) * height) / 2),
      );
      frame.style.strokeDashoffset = String(1 - progress.frameProgress);
      element.style.opacity = String(progress.opacity);
      if (progress.complete) finishTransition();
    };
    const resize = () => {
      const width = Math.max(element.clientWidth, 1);
      const height = Math.max(element.clientHeight, 1);
      renderer.setSize(width, height, false);
      solarSystem.resize(width, height);
      applyTransition(performance.now());
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    resize();

    const themeObserver = new MutationObserver(() => {
      const nextPalette = readPalette();
      material.uniforms.uColor.value.setStyle(nextPalette.foreground);
      solarSystem.setPalette(nextPalette);
      render();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    controls.current = {
      beginSetup() {
        if (transition) return transition.promise;
        if (reducedMotion.matches || document.hidden || !webglAvailable)
          return Promise.resolve(true);
        let resolve!: (completed: boolean) => void;
        const promise = new Promise<boolean>((done) => {
          resolve = done;
        });
        transition = {
          startedAt: performance.now(),
          finished: false,
          promise,
          resolve,
          timeout: window.setTimeout(
            finishTransition,
            WELCOME_SETUP_DURATION_MS + 350,
          ),
        };
        element.dataset.transitioning = "true";
        applyTransition(transition.startedAt);
        render();
        return promise;
      },
      reset() {
        if (transition) {
          window.clearTimeout(transition.timeout);
          if (!transition.finished) transition.resolve(false);
          transition = null;
        }
        delete element.dataset.transitioning;
        element.style.removeProperty("opacity");
        frame.style.strokeDashoffset = "1";
        camera.position.set(0, 0, 0);
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        render();
      },
    };
    const contextLost = () => {
      webglAvailable = false;
      finishTransition();
    };
    const contextRestored = () => {
      webglAvailable = true;
    };
    const visibilityChanged = () => {
      if (document.hidden) finishTransition();
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      contextRestored,
    );
    document.addEventListener("visibilitychange", visibilityChanged);
    const startedAt = performance.now();
    let animationFrame = 0;
    const draw = (time: number) => {
      if (transition) {
        if (reducedMotion.matches) finishTransition();
        else applyTransition(time);
      } else if (!reducedMotion.matches) {
        const elapsed = (time - startedAt) / 1000;
        material.uniforms.uTime.value = elapsed * 0.25;
        solarSystem.update(elapsed);
      }
      render();
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);

    return () => {
      if (transition) {
        window.clearTimeout(transition.timeout);
        if (!transition.finished) transition.resolve(false);
      }
      controls.current = skipTransition;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        contextRestored,
      );
      document.removeEventListener("visibilitychange", visibilityChanged);
      geometry.dispose();
      material.dispose();
      solarSystem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={host} className="welcome-node-field" aria-hidden="true">
      <svg className="welcome-target-frame" aria-hidden="true">
        <rect ref={targetFrame} pathLength="1" />
      </svg>
    </div>
  );
}
