"use client";

import Link from "next/link";
import { useMemo, type ChangeEvent } from "react";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { NotebookChat } from "@/components/notebook-chat";
import { NotebookSources } from "@/components/notebook-sources";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const typedNotebookId = useMemo(
    () => notebookId as Id<"notebooks">,
    [notebookId],
  );
  const notebook = useQuery(api.notebooks.getNotebook, {
    notebookId: typedNotebookId,
  });
  const notebooks = useQuery(api.notebooks.listNotebooks, {});

  if (notebook === undefined) {
    return (
      <main className="min-h-screen px-4 py-10 dark:bg-[#111111] sm:px-6">
        <Card className="mx-auto w-full max-w-214 border-[#e9e9e6] shadow-none dark:border-white/10 dark:bg-[#181818]">
          <CardHeader>
            <CardTitle>Loading notebook...</CardTitle>
            <CardDescription>Pulling the workspace together.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (notebook === null) {
    return (
      <main className="min-h-screen px-4 py-10 dark:bg-[#111111] sm:px-6">
        <Card className="mx-auto w-full max-w-214 border-[#e9e9e6] shadow-none dark:border-white/10 dark:bg-[#181818]">
          <CardHeader>
            <CardTitle>Notebook not found</CardTitle>
            <CardDescription>
              That notebook either doesn&apos;t exist or wandered off into the
              void.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">Back to overview</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const notebookOptions =
    notebooks?.some((candidate) => candidate._id === notebook._id)
      ? notebooks
      : [notebook, ...(notebooks ?? [])];

  const handleNotebookSwitch = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextNotebookId = event.target.value.trim();
    if (!nextNotebookId || nextNotebookId === notebookId) {
      return;
    }

    router.push(`/${nextNotebookId}`);
  };

  return (
    <main className="min-h-screen px-4 text-[#171717] dark:bg-[#111111] dark:text-[#f3f3ef] sm:px-6">
      <div className="mx-auto flex w-full max-w-214 flex-col">
        <Tabs defaultValue="chat" className="flex-1">
          <div className="sticky top-0 z-20 -mx-4 mb-6 bg-white/50 px-4 pb-3 backdrop-blur dark:bg-[#111111]/95 sm:-mx-6 sm:px-6">
            <div className="mb-7 flex items-start justify-between gap-4 pt-4">
              <div className="relative max-w-[75vw]">
                <label htmlFor="workspace-notebook-switch" className="sr-only">
                  Switch notebook
                </label>
                <select
                  id="workspace-notebook-switch"
                  value={notebookId}
                  onChange={handleNotebookSwitch}
                  disabled={notebooks === undefined}
                  className="w-full appearance-none rounded-md bg-transparent py-1 pl-1 pr-7 text-sm font-medium tracking-[-0.02em] text-[#171717] outline-none transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-80 dark:text-[#f3f3ef]"
                >
                  {notebookOptions.map((option) => (
                    <option key={option._id} value={option._id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-4 -translate-y-1/2 stroke-[1.75] text-[#171717] dark:text-[#f3f3ef]" />
              </div>

              <Button
                asChild
                variant="ghost"
                className="h-auto px-2 py-1 text-sm text-[#6f6f6f] hover:bg-transparent hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:text-[#f3f3ef]"
              >
                <Link href="/">Back</Link>
              </Button>
            </div>

            <TabsList className="h-auto w-full justify-start gap-2 rounded-none border-b border-[#e5e5e5] bg-transparent p-0 text-[#6f6f6f] dark:border-white/10 dark:text-[#a1a1aa]">
              <TabsTrigger
                value="chat"
                className="h-auto rounded-none border-b border-transparent px-2 py-1 text-sm font-normal tracking-[-0.02em] shadow-none data-[state=active]:border-[#171717] data-[state=active]:bg-transparent data-[state=active]:text-[#171717] data-[state=active]:shadow-none dark:data-[state=active]:border-[#f3f3ef] dark:data-[state=active]:text-[#f3f3ef]"
              >
                Chat
              </TabsTrigger>
              <TabsTrigger
                value="sources"
                className="h-auto rounded-none border-b border-transparent px-2 py-1 text-sm font-normal tracking-[-0.02em] shadow-none data-[state=active]:border-[#171717] data-[state=active]:bg-transparent data-[state=active]:text-[#171717] data-[state=active]:shadow-none dark:data-[state=active]:border-[#f3f3ef] dark:data-[state=active]:text-[#f3f3ef]"
              >
                Sources
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="mt-0">
            <NotebookChat notebookId={typedNotebookId} />
          </TabsContent>

          <TabsContent value="sources" className="mt-0">
            <NotebookSources notebookId={typedNotebookId} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
