// Known production wire payloads at 2026-07-17T12:00:00.000Z.
const footer = [
  { type: 14, divider: true, spacing: 1 },
  { type: 10, content: "-# <t:1784289600:F>" },
];

const pendingControls = {
  type: 1,
  components: [
    { type: 2, custom_id: "sc_approve_request-1", label: "Approve", style: 3 },
    { type: 2, custom_id: "sc_reject_request-1", label: "Reject", style: 4 },
  ],
};

const completedControls = {
  type: 1,
  components: [
    { ...pendingControls.components[0], disabled: true },
    { ...pendingControls.components[1], disabled: true },
  ],
};

export const previewControls = {
  type: 1,
  components: [
    {
      type: 2,
      custom_id: "debug_approve",
      label: "Approve",
      style: 3,
      disabled: true,
    },
    {
      type: 2,
      custom_id: "debug_reject",
      label: "Reject",
      style: 4,
      disabled: true,
    },
  ],
};

export const registrationResponses = {
  pending: {
    components: [
      {
        type: 17,
        accent_color: 16753920,
        components: [
          { type: 10, content: "## <@user-1>, review this registration" },
          {
            type: 10,
            content:
              "Approve or reject **Debug User**'s request to join **Debug World**.",
          },
          ...footer,
          pendingControls,
        ],
      },
    ],
    flags: 32768,
    allowedMentions: { users: ["user-1"] },
  },
  approved: {
    components: [
      {
        type: 17,
        accent_color: 16753920,
        components: [
          { type: 10, content: "## Registration approved" },
          {
            type: 10,
            content:
              "**Debug User** joined [Debug World](https://shadow.example/games/42) as seat 2.",
          },
          ...footer,
          completedControls,
        ],
      },
    ],
    flags: 32768,
  },
  rejected: {
    components: [
      {
        type: 17,
        accent_color: 16753920,
        components: [
          { type: 10, content: "## Registration rejected" },
          {
            type: 10,
            content:
              "**Debug User**'s request to join [Debug World](https://shadow.example/games/42) was rejected.",
          },
          ...footer,
          completedControls,
        ],
      },
    ],
    flags: 32768,
  },
};
