import { describe, expect, it } from "vitest";
import { canReplaceSaveFile } from "@/lib/save-file-replacement";

describe("canReplaceSaveFile", () => {
  const cases = [
    {
      name: "allows the original uploader",
      input: {
        currentUserId: "owner-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: false,
        shadowOverrideEnabled: false,
      },
      expected: true,
    },
    {
      name: "allows an enabled Shadow override user for another uploader",
      input: {
        currentUserId: "shadow-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: true,
        shadowOverrideEnabled: true,
      },
      expected: true,
    },
    {
      name: "denies a Shadow override user while the override is disabled",
      input: {
        currentUserId: "shadow-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: true,
        shadowOverrideEnabled: false,
      },
      expected: false,
    },
    {
      name: "denies an incapable user even when the override cookie is enabled",
      input: {
        currentUserId: "member-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: false,
        shadowOverrideEnabled: true,
      },
      expected: false,
    },
    {
      name: "denies an organizer who did not upload the file",
      input: {
        currentUserId: "organizer-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: false,
        shadowOverrideEnabled: false,
      },
      expected: false,
    },
    {
      name: "denies a participant who did not upload the file",
      input: {
        currentUserId: "participant-1",
        uploadedById: "owner-1",
        isShadowOverrideUser: false,
        shadowOverrideEnabled: false,
      },
      expected: false,
    },
    {
      name: "denies a signed-out visitor",
      input: {
        currentUserId: null,
        uploadedById: "owner-1",
        isShadowOverrideUser: false,
        shadowOverrideEnabled: false,
      },
      expected: false,
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(canReplaceSaveFile(input)).toBe(expected);
  });
});
