"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileText, Trash2, Upload } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { SourcePreviewDialog } from "@/components/notebook-sources/source-preview-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function isSupportedSourceFile(file: File) {
  return /\.(md|markdown|txt|pdf)$/i.test(file.name);
}

function isPdfFile(file: File) {
  return /\.pdf$/i.test(file.name);
}

function sourceNameFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "");
}

async function extractPdfContent(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/sources/pdf-to-markdown", {
    method: "POST",
    body: formData,
  });

  const body = (await response.json()) as {
    content?: string;
    error?: string;
    pageCount?: number;
    extractionWarnings?: string[];
  };

  if (!response.ok || !body.content) {
    throw new Error(body.error ?? "Could not convert the PDF.");
  }

  return {
    content: body.content,
    pageCount: body.pageCount ?? 0,
    extractionWarnings: body.extractionWarnings ?? [],
  };
}

export function NotebookSources({
  notebookId,
  selectedSourceId: selectedSourceIdProp,
  onSelectedSourceIdChange,
}: {
  notebookId: Id<"notebooks">;
  selectedSourceId?: Id<"documents"> | null;
  onSelectedSourceIdChange?: (sourceId: Id<"documents"> | null) => void;
}) {
  const sources = useQuery(api.sources.listSources, { notebookId });
  const ingestMarkdownSource = useAction(api.sources.ingestMarkdownSource);
  const deleteSource = useMutation(api.sources.deleteSource);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] =
    useState<Id<"documents"> | null>(null);
  const [internalSelectedSourceId, setInternalSelectedSourceId] =
    useState<Id<"documents"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selectedSourceId =
    selectedSourceIdProp === undefined
      ? internalSelectedSourceId
      : selectedSourceIdProp;

  const setSelectedSourceId = (sourceId: Id<"documents"> | null) => {
    if (selectedSourceIdProp === undefined) {
      setInternalSelectedSourceId(sourceId);
    }

    onSelectedSourceIdChange?.(sourceId);
  };

  const selectedSource = useQuery(
    api.sources.getSource,
    selectedSourceId ? { documentId: selectedSourceId } : "skip",
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isSupportedSourceFile(file)) {
      setError(
        "Please upload a markdown, text, or PDF file (.md, .markdown, .txt, .pdf).",
      );
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    setError(null);
    setStatus(null);

    try {
      const extraction = isPdfFile(file)
        ? await extractPdfContent(file)
        : { content: await file.text(), pageCount: 0, extractionWarnings: [] };

      const result = await ingestMarkdownSource({
        notebookId,
        name: sourceNameFromFile(file),
        content: extraction.content,
      });

      setStatus(
        isPdfFile(file)
          ? `Converted ${extraction.pageCount} PDF page${extraction.pageCount === 1 ? "" : "s"}, uploaded ${file.name}, and created ${result.chunkCount} searchable chunks.${extraction.extractionWarnings.length > 0 ? ` Notes: ${extraction.extractionWarnings.join(" ")}` : ""}`
          : `Uploaded ${file.name} and created ${result.chunkCount} searchable chunks.`,
      );
      event.target.value = "";
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not upload the source.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentId: Id<"documents">) => {
    setDeletingDocumentId(documentId);
    setError(null);
    setStatus(null);

    if (selectedSourceId === documentId) {
      setSelectedSourceId(null);
    }

    try {
      await deleteSource({ documentId });
      setStatus("Source deleted.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not delete the source.",
      );
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const sourceCountLabel =
    sources === undefined
      ? "Loading..."
      : `${sources.length} source${sources.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6 pb-8">
      <section className="rounded-2xl border border-[#e5e5e5] bg-white/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
        <div className="space-y-2">
          <h2 className="text-base font-medium tracking-[-0.02em] text-[#171717] dark:text-[#f3f3ef]">
            Upload sources
          </h2>
          <p className="text-sm leading-6 text-[#6f6f6f] dark:text-[#a1a1aa]">
            Upload markdown, text, or PDF files and they&apos;ll be converted,
            chunked, embedded, and indexed for notebook chat.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          <Input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
            onChange={(event) => void handleUpload(event)}
            disabled={isUploading}
            className="h-11 border-[#e5e5e5] bg-white text-sm text-[#171717] file:mr-3 file:rounded-md file:border-0 file:bg-[#f2f2f0] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#171717] hover:file:bg-[#ececea] dark:border-white/10 dark:bg-[#111111] dark:text-[#f3f3ef] dark:file:bg-white/10 dark:file:text-[#f3f3ef] dark:hover:file:bg-white/15"
          />

          <div className="flex items-center gap-2 text-sm text-[#6f6f6f] dark:text-[#a1a1aa]">
            <Upload className="size-4" />
            <span>
              Supported today: Markdown, plain text, and text-based PDF uploads.
              Scanned PDFs use local OCR when <code>pdftoppm</code> and{" "}
              <code>tesseract</code> are installed.
            </span>
          </div>

          {error ? (
            <p className="text-sm text-[#d22f2f] dark:text-[#ff8a8a]">{error}</p>
          ) : null}
          {status ? (
            <p className="text-sm text-[#171717] dark:text-[#f3f3ef]">{status}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[#e5e5e5] bg-white/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium tracking-[-0.02em] text-[#171717] dark:text-[#f3f3ef]">
              Indexed sources
            </h2>
            <p className="mt-1 text-sm text-[#6f6f6f] dark:text-[#a1a1aa]">
              These files are searched for answers in this notebook.
            </p>
          </div>
          <span className="rounded-full bg-[#f2f2f0] px-3 py-1 text-xs font-medium text-[#6f6f6f] dark:bg-white/10 dark:text-[#a1a1aa]">
            {sourceCountLabel}
          </span>
        </div>

        <div className="space-y-3">
          {sources === undefined ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-2xl border border-dashed border-[#e5e5e5] bg-[#f8f8f7] dark:border-white/10 dark:bg-white/5"
                />
              ))}
            </div>
          ) : sources.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#e5e5e5] p-6 text-sm text-[#6f6f6f] dark:border-white/10 dark:text-[#a1a1aa]">
              No sources yet. Upload a markdown, text, or PDF document to power
              the chat with notebook-specific context.
            </div>
          ) : (
            sources.map((source) => (
              <div
                key={source._id}
                className="flex flex-col gap-4 rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 transition-colors hover:bg-[#fafaf9] sm:flex-row sm:items-start sm:justify-between dark:border-white/10 dark:bg-[#111111] dark:hover:bg-[#161616]"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 space-y-2 text-left"
                  onClick={() => setSelectedSourceId(source._id)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-[#6f6f6f] dark:text-[#a1a1aa]" />
                    <p className="truncate font-medium text-[#171717] dark:text-[#f3f3ef]">
                      {source.name}
                    </p>
                  </div>
                  <p className="text-sm text-[#6f6f6f] dark:text-[#a1a1aa]">
                    {source.chunkCount} chunk
                    {source.chunkCount === 1 ? "" : "s"} · added{" "}
                    {new Date(source._creationTime).toLocaleDateString()}
                  </p>
                  <p className="line-clamp-3 text-sm text-[#6f6f6f] dark:text-[#a1a1aa]">
                    {source.preview || "No preview available."}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[#6f6f6f] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]"
                  onClick={() => void handleDelete(source._id)}
                  disabled={deletingDocumentId === source._id}
                >
                  <Trash2 className="size-4" />
                  {deletingDocumentId === source._id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <SourcePreviewDialog
        open={selectedSourceId !== null}
        source={selectedSource}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSourceId(null);
          }
        }}
      />
    </div>
  );
}
