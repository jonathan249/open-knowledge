"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import {
  NotebookDialogState,
  NotebookOverviewDialog,
} from "@/components/notebook-overview-dialog";
import {
  NotebookOverviewCard,
  NotebookOverviewEmptyState,
  NotebookOverviewSkeletonCard,
} from "@/components/notebook-overview-card";
import { NotebookOverviewHeader } from "@/components/notebook-overview-header";

const initialDialogState: NotebookDialogState = { open: false };

export function NotebookOverview() {
  const notebooks = useQuery(api.notebooks.listNotebooks, {});
  const createNotebook = useMutation(api.notebooks.createNotebook);
  const updateNotebook = useMutation(api.notebooks.updateNotebook);
  const deleteNotebook = useMutation(api.notebooks.deleteNotebook);

  const [dialogState, setDialogState] =
    useState<NotebookDialogState>(initialDialogState);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notebookCountLabel = useMemo(() => {
    if (!notebooks) {
      return "Loading notebooks...";
    }

    return `${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"}`;
  }, [notebooks]);

  const openCreateDialog = () => {
    setDialogState({ open: true, mode: "create", initialName: "" });
    setName("");
    setError(null);
  };

  const openUpdateDialog = (
    notebookId: Id<"notebooks">,
    initialName: string,
  ) => {
    setDialogState({
      open: true,
      mode: "update",
      notebookId,
      initialName,
    });
    setName(initialName);
    setError(null);
  };

  const openDeleteDialog = (
    notebookId: Id<"notebooks">,
    initialName: string,
  ) => {
    setDialogState({
      open: true,
      mode: "delete",
      notebookId,
      initialName,
    });
    setName(initialName);
    setError(null);
  };

  const closeDialog = (open: boolean) => {
    if (open) {
      return;
    }

    setDialogState(initialDialogState);
    setName("");
    setError(null);
  };

  const handleSave = async () => {
    if (!dialogState.open) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (dialogState.mode === "create") {
        await createNotebook({ name });
      } else if (dialogState.mode === "update" && dialogState.notebookId) {
        await updateNotebook({ notebookId: dialogState.notebookId, name });
      } else if (dialogState.mode === "delete" && dialogState.notebookId) {
        await deleteNotebook({ notebookId: dialogState.notebookId });
      }

      setDialogState(initialDialogState);
      setName("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not save notebook.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <NotebookOverviewHeader
        notebookCountLabel={notebookCountLabel}
        onCreateNotebook={openCreateDialog}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {notebooks === undefined &&
          Array.from({ length: 3 }).map((_, index) => (
            <NotebookOverviewSkeletonCard key={index} />
          ))}

        {notebooks?.map((notebook) => (
          <NotebookOverviewCard
            key={notebook._id}
            notebook={notebook}
            onRename={openUpdateDialog}
            onDelete={openDeleteDialog}
          />
        ))}
      </section>

      {notebooks?.length === 0 && (
        <NotebookOverviewEmptyState onCreateNotebook={openCreateDialog} />
      )}

      <NotebookOverviewDialog
        dialogState={dialogState}
        name={name}
        error={error}
        isSaving={isSaving}
        onNameChange={setName}
        onOpenChange={closeDialog}
        onSave={handleSave}
      />
    </div>
  );
}
