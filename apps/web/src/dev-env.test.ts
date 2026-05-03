import { describe, expect, it } from "vitest";
import {
  parseEnvFile,
  resolveWebPort,
  resolveWebUrl,
} from "../../../scripts/dev-env.mjs";

describe("dev env helpers", () => {
  it("parses quoted .env values", () => {
    expect(
      parseEnvFile(
        'API_PORT=3101\nSHADOW_CLOUD_API_URL="http://localhost:3101"\n',
      ),
    ).toEqual({
      API_PORT: "3101",
      SHADOW_CLOUD_API_URL: "http://localhost:3101",
    });
  });

  it("resolves the frontend URL from AUTH_URL before falling back to WEB_PORT", () => {
    expect(
      resolveWebUrl({ NODE_ENV: "test", AUTH_URL: "http://localhost:3200" }),
    ).toBe("http://localhost:3200");
    expect(resolveWebUrl({ NODE_ENV: "test", WEB_PORT: "3200" })).toBe(
      "http://localhost:3200",
    );
  });

  it("resolves the frontend port from WEB_PORT before AUTH_URL", () => {
    expect(
      resolveWebPort({
        NODE_ENV: "test",
        WEB_PORT: "3200",
        AUTH_URL: "http://localhost:3300",
      }),
    ).toBe("3200");
    expect(
      resolveWebPort({ NODE_ENV: "test", AUTH_URL: "http://localhost:3300" }),
    ).toBe("3300");
  });
});
