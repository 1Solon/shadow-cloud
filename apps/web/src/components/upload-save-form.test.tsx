// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadSaveForm } from "@/components/upload-save-form";

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: {
    refresh: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

const fetchMock = vi.fn();
const compactDropZoneLabel =
  "Download the latest save above. When you’ve finished your turn, click here or drag and drop your new save for the next Lord.";

function mockResponse(
  ok: boolean,
  payload: { error?: string; redirectTo?: string } = {},
): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function expectAdjacentMessage(dropZone: HTMLElement, message: string) {
  expect(dropZone.nextElementSibling).toHaveTextContent(message);
}

describe("UploadSaveForm", () => {
  beforeEach(() => {
    mockRouter.refresh.mockReset();
    mockRouter.replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the standard presentation by default", async () => {
    const user = userEvent.setup();
    render(<UploadSaveForm gameNumber={42} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop save files here",
    });
    expect(dropZone).toHaveClass("px-8", "py-14");
    expect(screen.getByText("> DROP SAVE FILES HERE")).toBeInTheDocument();
    expect(
      screen.getByText("Drag and drop your .se1 save files here"),
    ).toBeInTheDocument();
    expect(screen.getByText("> SELECT FILES")).toBeInTheDocument();
    expect(screen.getByText("> UPLOAD INSTRUCTIONS")).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("Save file"),
      new File(["save"], "standard.se1"),
    );
    expect(
      screen.getByRole("button", { name: "Upload save and advance turn" }),
    ).toHaveClass("h-11", "px-6");
  });

  it("uses a full-height singular compact presentation without instructions", () => {
    const { container } = render(
      <UploadSaveForm gameNumber={42} presentation="compact" />,
    );

    const form = container.querySelector("form");
    const dropZone = screen.getByRole("button", {
      name: compactDropZoneLabel,
    });
    expect(form).toHaveClass("flex", "h-full", "flex-col");
    expect(dropZone).toHaveClass(
      "flex",
      "flex-1",
      "flex-col",
      "justify-center",
      "px-4",
      "py-6",
      "text-left",
    );
    expect(screen.getByText(`> ${compactDropZoneLabel}`)).toBeInTheDocument();
    expect(screen.queryByText("> SELECT FILE")).not.toBeInTheDocument();
    expect(screen.queryByText("> UPLOAD INSTRUCTIONS")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(within(dropZone).queryByRole("button")).not.toBeInTheDocument();
  });

  it("stages, replaces, and clears a file in the compact presentation", async () => {
    const user = userEvent.setup();
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);
    const input = screen.getByLabelText("Save file");
    const firstFile = new File(["first"], "first.se1");
    const replacementFile = new File(["replacement"], "replacement.se1");

    await user.upload(input, firstFile);
    expect(
      screen.getByRole("button", { name: "Selected save file first.se1" }),
    ).toBeInTheDocument();

    fireEvent.drop(
      screen.getByRole("button", { name: "Selected save file first.se1" }),
      {
        dataTransfer: { files: [replacementFile] },
      },
    );
    expect(
      screen.getByRole("button", {
        name: "Selected save file replacement.se1",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("button", { name: compactDropZoneLabel }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("wraps long selected filenames and contains the compact submit action", async () => {
    const user = userEvent.setup();
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);
    const longName = `${"long-save-name-".repeat(12)}.se1`;

    await user.upload(
      screen.getByLabelText("Save file"),
      new File(["save"], longName),
    );

    expect(screen.getByText(`> ${longName}`)).toHaveClass(
      "min-w-0",
      "[overflow-wrap:anywhere]",
    );
    expect(
      screen.getByRole("button", { name: "Upload save and advance turn" }),
    ).toHaveClass(
      "max-w-full",
      "whitespace-normal",
      "h-auto",
      "min-h-11",
      "px-4",
      "py-3",
      "text-center",
    );
  });

  it.each(["click", "Enter", " "])(
    "opens the file picker with %s",
    async (interaction) => {
      const user = userEvent.setup();
      render(<UploadSaveForm gameNumber={42} presentation="compact" />);
      const input = screen.getByLabelText("Save file");
      const clickSpy = vi.spyOn(input, "click");
      const dropZone = screen.getByRole("button", {
        name: compactDropZoneLabel,
      });

      if (interaction === "click") {
        await user.click(dropZone);
      } else {
        dropZone.focus();
        await user.keyboard(interaction === " " ? "[Space]" : "[Enter]");
      }

      expect(clickSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("shows adjacent validation when submitted without a file", () => {
    const { container } = render(
      <UploadSaveForm gameNumber={42} presentation="compact" />,
    );
    const dropZone = screen.getByRole("button", {
      name: compactDropZoneLabel,
    });

    fireEvent.submit(container.querySelector("form")!);

    expectAdjacentMessage(dropZone, "Choose a save file to upload.");
  });

  it("posts the selected file and follows the successful redirect", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(true, { redirectTo: "/games/42/turn/9" }),
    );
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);
    const file = new File(["save-data"], "turn.se1");

    await user.upload(screen.getByLabelText("Save file"), file);
    await user.click(
      screen.getByRole("button", { name: "Upload save and advance turn" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/games/42/files");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const uploadedFile = (init.body as FormData).get("file") as File;
    expect(uploadedFile.name).toBe(file.name);
    expect(await uploadedFile.text()).toBe("save-data");
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith("/games/42/turn/9", {
        scroll: false,
      });
      expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("prevents duplicate submissions while the upload is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);

    await user.upload(
      screen.getByLabelText("Save file"),
      new File(["save"], "turn.se1"),
    );
    await user.click(
      screen.getByRole("button", { name: "Upload save and advance turn" }),
    );

    const pendingButton = screen.getByRole("button", { name: "Uploading..." });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest!(mockResponse(true));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
  });

  it.each([
    [
      "API",
      () => Promise.resolve(mockResponse(false, { error: "Upload denied." })),
      "Upload denied.",
    ],
    [
      "network",
      () => Promise.reject(new Error("offline")),
      "The save upload request failed before reaching the server.",
    ],
  ])(
    "keeps %s errors adjacent to the drop zone",
    async (_kind, response, message) => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(response);
      render(<UploadSaveForm gameNumber={42} presentation="compact" />);
      const file = new File(["save"], "turn.se1");

      await user.upload(screen.getByLabelText("Save file"), file);
      const dropZone = screen.getByRole("button", {
        name: "Selected save file turn.se1",
      });
      await user.click(
        screen.getByRole("button", { name: "Upload save and advance turn" }),
      );

      await waitFor(() => expectAdjacentMessage(dropZone, message));
      expect(
        screen.getByRole("button", { name: "Upload save and advance turn" }),
      ).toBeEnabled();
    },
  );
});
