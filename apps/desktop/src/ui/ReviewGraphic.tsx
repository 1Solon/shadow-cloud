import { useEffect, useRef } from "react";
import { OrthographicCamera, Scene, WebGLRenderer } from "three";
import { createWelcomeSpaceStation } from "./welcomeSpaceStation";

export function ReviewGraphic() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (
      !element ||
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
    const readPalette = () => {
      const style = getComputedStyle(element);
      return {
        foreground: style.getPropertyValue("--foreground").trim() || "#fb923c",
        bright: style.getPropertyValue("--bright").trim() || "#fed7aa",
      };
    };
    const station = createWelcomeSpaceStation(readPalette(), { active: true });
    const scene = new Scene();
    scene.add(station.group);
    const camera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 20);
    camera.position.set(0, 0.25, 8);
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.appendChild(renderer.domElement);

    let contextAvailable = true;
    const render = () => {
      if (contextAvailable) renderer.render(scene, camera);
    };
    const resize = () => {
      const width = Math.max(element.clientWidth, 1);
      const height = Math.max(element.clientHeight, 1);
      const aspect = width / height;
      const viewHeight = Math.max(6.2, 4.6 / aspect);
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    resize();

    const themeObserver = new MutationObserver(() => {
      station.setPalette(readPalette());
      render();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let elapsed = 0;
    let previousTime: number | null = null;
    const draw = (time: number) => {
      if (previousTime !== null)
        elapsed += Math.min(time - previousTime, 50) / 1000;
      previousTime = time;
      station.update(elapsed);
      render();
      frame = requestAnimationFrame(draw);
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame);
      previousTime = null;
      if (!reducedMotion.matches && !document.hidden && contextAvailable)
        frame = requestAnimationFrame(draw);
      else render();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      contextAvailable = false;
      updateMotion();
    };
    const contextRestored = () => {
      contextAvailable = true;
      resize();
      updateMotion();
    };
    reducedMotion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateMotion);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      contextRestored,
    );
    updateMotion();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      reducedMotion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateMotion);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        contextRestored,
      );
      station.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      className="review-graphic"
      role="img"
      aria-label="Active space station with illuminated habitats and docking traffic"
    >
      <div className="review-station-status" aria-hidden="true">
        <span>STATION SYSTEMS</span>
        <span>
          <i /> ACTIVE
        </span>
      </div>
      <div ref={host} className="review-station-field" aria-hidden="true" />
    </div>
  );
}
