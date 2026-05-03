import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next.js routing config", () => {
  it("rewrites public v1 API requests to the backend API service", async () => {
    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toContainEqual({
      source: "/v1/:path*",
      destination: "http://localhost:3001/v1/:path*",
    });
  });
});
