import { Button } from "@/components/ui/button";

export function NotebookOverviewHeader({
  onCreateNotebook,
}: {
  onCreateNotebook: () => void;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#e5e5e5] bg-white/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] backdrop-blur dark:border-white/10 dark:bg-[#181818] dark:shadow-none sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-[#6f6f6f] dark:text-[#a1a1aa]">
          Notebook overview
        </p>
        <h1 className="mt-2 text-4xl font-medium tracking-[-0.04em] text-[#171717] dark:text-[#f3f3ef]">
          Open Knowledge
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6f6f6f] dark:text-[#a1a1aa]">
          Create notebooks, rename them in-place, and jump into a dedicated
          workspace with sources and chat tabs.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={onCreateNotebook}
          className="h-9 rounded-lg bg-[#171717] px-3 text-sm font-medium text-[#f3f3ef] hover:bg-[#000000] dark:bg-[#f3f3ef] dark:text-[#171717] dark:hover:bg-[#e7e7e2]"
        >
          Create notebook
        </Button>
      </div>
    </header>
  );
}
