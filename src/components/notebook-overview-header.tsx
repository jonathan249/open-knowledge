import { Button } from "@/components/ui/button";

export function NotebookOverviewHeader({
  notebookCountLabel,
  onCreateNotebook,
}: {
  notebookCountLabel: string;
  onCreateNotebook: () => void;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 rounded-3xl border bg-card/80 p-6 shadow-sm backdrop-blur sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Notebook overview
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Open Knowledge
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Create notebooks, rename them in-place, and jump into a dedicated
          workspace with sources and chat tabs.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground">
          {notebookCountLabel}
        </span>
        <Button onClick={onCreateNotebook}>Create notebook</Button>
      </div>
    </header>
  );
}
