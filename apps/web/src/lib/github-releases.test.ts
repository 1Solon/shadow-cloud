import { afterEach, expect, it, vi } from "vitest";
import { listReleases } from "./github-releases";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("maps GitHub releases to their name, date and notes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json([
        {
          name: "0.19.0",
          tag_name: "0.19.0",
          published_at: "2026-09-28T22:46:03Z",
          body: "## Added",
        },
        { name: "", tag_name: "0.18.0", published_at: null, body: null },
      ]),
    ),
  );

  await expect(listReleases()).resolves.toEqual([
    { name: "0.19.0", publishedAt: "2026-09-28T22:46:03Z", body: "## Added" },
    { name: "0.18.0", publishedAt: "", body: "" },
  ]);
});

it.each([
  [
    "an error response",
    () => Promise.resolve(new Response(null, { status: 403 })),
  ],
  ["a network failure", () => Promise.reject(new Error("offline"))],
])("returns no releases on %s", async (_, respond) => {
  vi.stubGlobal("fetch", vi.fn(respond));

  await expect(listReleases()).resolves.toEqual([]);
});
