"use client";

import Markdown from "react-markdown";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SourcePreview = {
  _id: Id<"documents">;
  _creationTime: number;
  name: string;
  content: string;
  chunkCount: number;
};

export function SourcePreviewDialog({
  open,
  source,
  onOpenChange,
}: {
  open: boolean;
  source: SourcePreview | null | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden border-[#e5e5e5] bg-white p-0 dark:border-white/10 dark:bg-[#181818]">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b border-[#e5e5e5] px-6 py-5 dark:border-white/10">
            <DialogTitle>{source?.name ?? "Loading source..."}</DialogTitle>
            <DialogDescription>
              {source
                ? `${source.chunkCount} chunk${source.chunkCount === 1 ? "" : "s"} · added ${new Date(source._creationTime).toLocaleDateString()}`
                : "Loading parsed source content."}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-[#171717] dark:text-[#f3f3ef]">
            {source === undefined ? (
              <div className="rounded-2xl border border-dashed border-[#e5e5e5] p-6 text-sm text-[#6f6f6f] dark:border-white/10 dark:text-[#a1a1aa]">
                Loading parsed content...
              </div>
            ) : source === null ? (
              <div className="rounded-2xl border border-dashed border-[#e5e5e5] p-6 text-sm text-[#6f6f6f] dark:border-white/10 dark:text-[#a1a1aa]">
                This source could not be found.
              </div>
            ) : (
              <div className="max-w-none [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1">
                <Markdown>{source.content}</Markdown>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
