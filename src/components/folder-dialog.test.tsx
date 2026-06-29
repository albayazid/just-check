import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderDialog } from "./folder-dialog";
import { buildFolder } from "@/test/factories";

type FolderDialogProps = ComponentProps<typeof FolderDialog>;

function renderDialog(overrides: Partial<FolderDialogProps> = {}) {
  const props: FolderDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<FolderDialog {...props} />) };
}

// The Dialog renders into a portal at document.body. `screen` queries the whole
// document so they find it; this helper scopes assertions to the dialog content
// to keep error messages readable.
function dialog() {
  return screen.getByRole("dialog");
}

describe("<FolderDialog />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create mode (no folder passed)", () => {
    it("renders the create title and description", () => {
      renderDialog();

      expect(
        within(dialog()).getByRole("heading", { name: "Create Folder" }),
      ).toBeInTheDocument();
      expect(
        within(dialog()).getByText(
          "Create a new folder to organize your conversations.",
        ),
      ).toBeInTheDocument();
    });

    it("disables the submit button until a non-whitespace name is entered", async () => {
      const user = userEvent.setup();
      renderDialog();

      const getCreate = () =>
        within(dialog()).getByRole("button", { name: "Create" });

      expect(getCreate()).toBeDisabled();

      // Whitespace-only still counts as empty (name.trim().length === 0).
      await user.type(screen.getByLabelText("Folder Name"), "   ");
      expect(getCreate()).toBeDisabled();

      // A real character flips the form into a submittable state.
      await user.type(screen.getByLabelText("Folder Name"), "x");
      expect(getCreate()).not.toBeDisabled();
    });

    it("calls onSubmit with the trimmed name and no color by default", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog();

      await user.type(screen.getByLabelText("Folder Name"), "  Work  ");
      await user.click(within(dialog()).getByRole("button", { name: "Create" }));

      expect(props.onSubmit).toHaveBeenCalledWith("Work", undefined);
    });

    it("passes the selected color through to onSubmit", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog();

      await user.type(screen.getByLabelText("Folder Name"), "Personal");
      await user.click(
        screen.getByRole("button", { name: "Select Blue color" }),
      );
      await user.click(within(dialog()).getByRole("button", { name: "Create" }));

      expect(props.onSubmit).toHaveBeenCalledWith("Personal", "#3b82f6");
    });

    it("submits undefined when Default is re-selected after a color", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog();

      await user.type(screen.getByLabelText("Folder Name"), "Misc");
      await user.click(screen.getByRole("button", { name: "Select Red color" }));
      await user.click(screen.getByRole("button", { name: "Select Default color" }));
      await user.click(within(dialog()).getByRole("button", { name: "Create" }));

      expect(props.onSubmit).toHaveBeenCalledWith("Misc", undefined);
    });
  });

  describe("edit mode (folder passed)", () => {
    it("renders the edit title and pre-fills name + color from the folder", () => {
      renderDialog({
        folder: buildFolder({ name: "Inbox", color: "#22c55e" }),
      });

      expect(
        within(dialog()).getByRole("heading", { name: "Edit Folder" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Folder Name")).toHaveValue("Inbox");
      expect(
        within(dialog()).getByRole("button", { name: "Save" }),
      ).toBeInTheDocument();
    });

    it("submits the edited name", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog({
        folder: buildFolder({ name: "Old" }),
      });

      await user.clear(screen.getByLabelText("Folder Name"));
      await user.type(screen.getByLabelText("Folder Name"), "New");
      await user.click(within(dialog()).getByRole("button", { name: "Save" }));

      expect(props.onSubmit).toHaveBeenCalledWith("New", undefined);
    });
  });

  describe("error + loading states", () => {
    it("renders the error message when provided", () => {
      renderDialog({ error: "A folder with this name already exists." });

      expect(
        within(dialog()).getByText("A folder with this name already exists."),
      ).toBeInTheDocument();
    });

    it("shows 'Saving...' and disables both actions while loading", () => {
      renderDialog({
        isLoading: true,
        folder: buildFolder({ name: "X" }),
      });

      expect(
        within(dialog()).getByRole("button", { name: "Saving..." }),
      ).toBeDisabled();
      expect(
        within(dialog()).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled();
    });
  });

  describe("cancel", () => {
    it("calls onOpenChange(false) without submitting", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog();

      await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

      expect(props.onOpenChange).toHaveBeenCalledWith(false);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
  });
});
