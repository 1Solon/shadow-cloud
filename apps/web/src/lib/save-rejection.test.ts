import { describe, expect, it } from "vitest";
import { getSaveRejectionLabel } from "@/lib/save-rejection";

const rejectableInput = {
  currentUserId: "member-1",
  latestSave: { id: "save-9", uploadedById: "uploader-1" },
  rejectableSaveId: "save-9",
  activePlayerUserId: "receiver-1",
  organizerId: "organizer-1",
  isShadowOverrideUser: false,
  shadowOverrideEnabled: false,
};

describe("getSaveRejectionLabel", () => {
  it.each([
    ["the uploader withdraws", { currentUserId: "uploader-1" }, "Withdraw"],
    ["the receiving seat rejects", { currentUserId: "receiver-1" }, "Reject"],
    ["the Overlord rejects", { currentUserId: "organizer-1" }, "Reject"],
    [
      "an enabled Shadow override user rejects",
      { isShadowOverrideUser: true, shadowOverrideEnabled: true },
      "Reject",
    ],
    [
      "a Shadow override user cannot while the override is disabled",
      { isShadowOverrideUser: true },
      null,
    ],
    [
      "an enabled override cookie does not empower an ordinary member",
      { shadowOverrideEnabled: true },
      null,
    ],
    ["another member cannot", {}, null],
    ["a signed-out visitor cannot", { currentUserId: null }, null],
    [
      "nobody can once the save is no longer rejectable",
      { currentUserId: "uploader-1", rejectableSaveId: null },
      null,
    ],
    [
      "nobody can when a different save is rejectable",
      { currentUserId: "organizer-1", rejectableSaveId: "save-8" },
      null,
    ],
    [
      "nobody can without a save",
      { currentUserId: "organizer-1", latestSave: null },
      null,
    ],
  ] as const)("%s", (_name, overrides, expected) => {
    expect(getSaveRejectionLabel({ ...rejectableInput, ...overrides })).toBe(
      expected,
    );
  });
});
