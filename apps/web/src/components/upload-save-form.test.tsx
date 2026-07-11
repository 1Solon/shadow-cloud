// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

  it("uses the standard presentation by default", () => {
    render(<UploadSaveForm gameNumber={42} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop save files here",
    });
    expect(dropZone).toHaveClass("px-8", "py-14");
    expect(screen.getByText("> DROP SAVE FILES HERE")).toBeInTheDocument();
    expect(
      screen.getByText("Drag and drop your .se1 save files here"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "> SELECT FILES" }),
    ).toBeInTheDocument();
    expect(screen.getByText("> UPLOAD INSTRUCTIONS")).toBeInTheDocument();
  });

  it("uses a shorter singular compact presentation without instructions", () => {
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);

    const dropZone = screen.getByRole("button", {
      name: "Drop save file here",
    });
    expect(dropZone).toHaveClass("px-4", "py-6");
    expect(screen.getByText("> DROP SAVE FILE HERE")).toBeInTheDocument();
    expect(
      screen.getByText("Drag and drop your .se1 save file here"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "> SELECT FILE" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("> UPLOAD INSTRUCTIONS")).not.toBeInTheDocument();
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
      screen.getByRole("button", { name: "Drop save file here" }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it.each(["Enter", " "])("opens the file picker with %s", async (key) => {
    const user = userEvent.setup();
    render(<UploadSaveForm gameNumber={42} presentation="compact" />);
    const input = screen.getByLabelText("Save file");
    const clickSpy = vi.spyOn(input, "click");

    screen.getByRole("button", { name: "Drop save file here" }).focus();
    await user.keyboard(key === " " ? "[Space]" : "[Enter]");

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("shows adjacent validation when submitted without a file", () => {
    const { container } = render(<UploadSaveForm gameNumber={42} />);
    const dropZone = screen.getByRole("button", {
      name: "Drop save files here",
    });

    fireEvent.submit(container.querySelector("form")!);

    expectAdjacentMessage(dropZone, "Choose a save file to upload.");
  });

  it("posts the selected file and follows the successful redirect", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(true, { redirectTo: "/games/42/turn/9" }),
    );
    render(<UploadSaveForm gameNumber={42} />);
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
    render(<UploadSaveForm gameNumber={42} />);

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
      render(<UploadSaveForm gameNumber={42} />);
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
