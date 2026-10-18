import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 5_000 });

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
