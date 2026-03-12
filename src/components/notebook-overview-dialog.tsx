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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dialogState.open && dialogState.mode === "create"
              ? "Create notebook"
              : dialogState.open && dialogState.mode === "update"
                ? "Update notebook"
                : "Delete notebook"}
          </DialogTitle>
          <DialogDescription>
            {dialogState.open && dialogState.mode === "delete"
              ? "This will permanently delete the notebook and all of its chat history."
              : "Give your notebook a clear, memorable name. You can always rename it later."}
          </DialogDescription>
        </DialogHeader>

        {dialogState.open && dialogState.mode === "delete" ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-muted-foreground">
            You are about to delete <span className="font-medium text-foreground">{dialogState.initialName}</span>.
            This action cannot be undone.
          </div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="notebook-name">Notebook name</Label>
            <Input
              id="notebook-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="e.g. Product research"
              autoFocus
            />
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
