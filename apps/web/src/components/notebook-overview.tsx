"use client";

import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import {
  NotebookDialogState,
  NotebookOverviewDialog,
} from "@/components/notebook-overview-dialog";
import { NotebookOverviewHeader } from "@/components/notebook-overview-header";
import { Button } from "@/components/ui/button";

const initialDialogState: NotebookDialogState = { open: false };

export function NotebookOverview() {
  const router = useRouter();
  const notebooks = useQuery(api.notebooks.listNotebooks, {});
  const createNotebook = useMutation(api.notebooks.createNotebook);
  const updateNotebook = useMutation(api.notebooks.updateNotebook);
  const deleteNotebook = useMutation(api.notebooks.deleteNotebook);

  const [dialogState, setDialogState] =
    useState<NotebookDialogState>(initialDialogState);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const openNotebook = (targetNotebookId: Id<"notebooks">) => {
    router.push(`/${targetNotebookId}`);
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    targetNotebookId: Id<"notebooks">,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openNotebook(targetNotebookId);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-214 flex-col px-4 py-6 text-[#171717] dark:text-[#f3f3ef] sm:px-6">
      <NotebookOverviewHeader onCreateNotebook={openCreateDialog} />

      <section className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-[#e5e5e5] bg-[#fafaf9] dark:border-white/10 dark:bg-[#151515]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#6f6f6f] dark:text-[#a1a1aa]">
                Notebook
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[#6f6f6f] dark:text-[#a1a1aa]">
                Created
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-[#6f6f6f] dark:text-[#a1a1aa]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e5e5] dark:divide-white/10">
            {notebooks === undefined &&
              Array.from({ length: 3 }).map((_, index) => (
                <tr key={index}>
                  <td className="px-4 py-4" colSpan={3}>
                    <div className="h-5 w-full animate-pulse rounded bg-[#ececea] dark:bg-white/10" />
                  </td>
                </tr>
              ))}

            {notebooks?.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-sm text-[#6f6f6f] dark:text-[#a1a1aa]"
                  colSpan={3}
                >
                  No notebooks yet. Create your first notebook to get started.
                </td>
              </tr>
            ) : null}

            {notebooks?.map((notebook) => (
              <tr
                key={notebook._id}
                role="button"
                tabIndex={0}
                onClick={() => openNotebook(notebook._id)}
                onKeyDown={(event) => handleRowKeyDown(event, notebook._id)}
                className="cursor-pointer bg-white transition-colors hover:bg-[#fafaf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171717]/20 dark:bg-[#181818] dark:hover:bg-[#1f1f1f] dark:focus-visible:ring-[#f3f3ef]/20"
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-[#171717] dark:text-[#f3f3ef]">
                    {notebook.name}
                  </p>
                </td>
                <td className="px-4 py-3 text-[#6f6f6f] dark:text-[#a1a1aa]">
                  {new Date(notebook._creationTime).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-[#6f6f6f] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]"
                      onClick={(event) => {
                        event.stopPropagation();
                        openUpdateDialog(notebook._id, notebook.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-[#6f6f6f] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDeleteDialog(notebook._id, notebook.name);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
