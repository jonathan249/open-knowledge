import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type NotebookDialogMode = "create" | "update" | "delete";

export type NotebookDialogState =
  | { open: false }
  | {
      open: true;
      mode: NotebookDialogMode;
      notebookId?: Id<"notebooks">;
      initialName: string;
    };

export function NotebookOverviewDialog({
  dialogState,
  name,
  error,
  isSaving,
  onNameChange,
  onOpenChange,
  onSave,
}: {
  dialogState: NotebookDialogState;
  name: string;
  error: string | null;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void | Promise<void>;
}) {
  return (
    <Dialog open={dialogState.open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#e5e5e5] bg-white text-[#171717] shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[#181818] dark:text-[#f3f3ef] dark:shadow-none">
        <DialogHeader>
          <DialogTitle>
            {dialogState.open && dialogState.mode === "create"
              ? "Create notebook"
              : dialogState.open && dialogState.mode === "update"
                ? "Update notebook"
                : "Delete notebook"}
          </DialogTitle>
          <DialogDescription className="text-[#6f6f6f] dark:text-[#a1a1aa]">
            {dialogState.open && dialogState.mode === "delete"
              ? "This will permanently delete the notebook and all of its chat history."
              : "Give your notebook a clear, memorable name. You can always rename it later."}
          </DialogDescription>
        </DialogHeader>

        {dialogState.open && dialogState.mode === "delete" ? (
          <div className="rounded-2xl border border-[#f1c0c0] bg-[#fff4f4] p-4 text-sm text-[#6f6f6f] dark:border-[#4a2626] dark:bg-[#2a1717] dark:text-[#a1a1aa]">
            You are about to delete{" "}
            <span className="font-medium text-[#171717] dark:text-[#f3f3ef]">
              {dialogState.initialName}
            </span>
            .
            This action cannot be undone.
          </div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="notebook-name" className="text-[#6f6f6f] dark:text-[#a1a1aa]">
              Notebook name
            </Label>
            <Input
              id="notebook-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="e.g. Product research"
              autoFocus
              className="h-11 border-[#e5e5e5] bg-white text-[#171717] placeholder:text-[#6f6f6f] dark:border-white/10 dark:bg-[#111111] dark:text-[#f3f3ef] dark:placeholder:text-[#a1a1aa]"
            />
          </div>
        )}

        {error ? (
          <p className="text-sm text-[#d22f2f] dark:text-[#ff8a8a]">{error}</p>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-[#e5e5e5] px-3 text-sm text-[#171717] hover:bg-[#f2f2f0] dark:border-white/10 dark:text-[#f3f3ef] dark:hover:bg-white/10"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={
              isSaving ||
              (dialogState.open && dialogState.mode !== "delete" && !name.trim())
            }
            variant={
              dialogState.open && dialogState.mode === "delete"
                ? "destructive"
                : "default"
            }
            className={
              dialogState.open && dialogState.mode === "delete"
                ? "h-9 rounded-md px-3"
                : "h-9 rounded-md bg-[#171717] px-3 text-[#f3f3ef] hover:bg-[#000000] dark:bg-[#f3f3ef] dark:text-[#171717] dark:hover:bg-[#e7e7e2]"
            }
          >
            {isSaving
              ? dialogState.open && dialogState.mode === "create"
                ? "Creating..."
                : dialogState.open && dialogState.mode === "delete"
                  ? "Deleting..."
                  : "Saving..."
              : dialogState.open && dialogState.mode === "create"
                ? "Create notebook"
                : dialogState.open && dialogState.mode === "delete"
                  ? "Delete notebook"
                  : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
