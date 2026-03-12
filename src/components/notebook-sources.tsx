"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileText, Trash2, Upload } from "lucide-react";
import Markdown from "react-markdown";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  };

  if (!response.ok || !body.content) {
    throw new Error(body.error ?? "Could not convert the PDF.");
  }

  return {
    content: body.content,
    pageCount: body.pageCount ?? 0,
  };
}

export function NotebookSources({
  notebookId,
}: {
  notebookId: Id<"notebooks">;
}) {
  const sources = useQuery(api.sources.listSources, { notebookId });
  const ingestMarkdownSource = useAction(api.sources.ingestMarkdownSource);
  const deleteSource = useMutation(api.sources.deleteSource);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] =
    useState<Id<"documents"> | null>(null);
  const [selectedSourceId, setSelectedSourceId] =
    useState<Id<"documents"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
        : { content: await file.text(), pageCount: 0 };

      const result = await ingestMarkdownSource({
        notebookId,
        name: sourceNameFromFile(file),
        content: extraction.content,
      });

      setStatus(
        isPdfFile(file)
          ? `Converted ${extraction.pageCount} PDF page${extraction.pageCount === 1 ? "" : "s"}, uploaded ${file.name}, and created ${result.chunkCount} searchable chunks.`
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload sources</CardTitle>
          <CardDescription>
            Upload markdown, text, or PDF files and they&apos;ll be converted
            when needed, chunked, embedded, and stored in Convex for
            retrieval-augmented chat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
            onChange={(event) => void handleUpload(event)}
            disabled={isUploading}
          />

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Upload className="size-4" />
            <span>
              Supported today: Markdown, plain text, and text-based PDF uploads.
              Scanned PDFs still need OCR.
            </span>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {status ? <p className="text-sm text-foreground">{status}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Indexed sources</CardTitle>
          <CardDescription>
            These source files are searched whenever you send a chat message in
            this notebook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources === undefined ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-2xl border border-dashed bg-muted/40"
                />
              ))}
            </div>
          ) : sources.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              No sources yet. Upload a markdown, text, or PDF document to power
              the chat with notebook-specific context.
            </div>
          ) : (
            sources.map((source) => (
              <div
                key={source._id}
                className="flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 space-y-2 text-left transition-opacity hover:opacity-80"
                  onClick={() => setSelectedSourceId(source._id)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-muted-foreground" />
                    <p className="truncate font-medium">{source.name}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {source.chunkCount} chunk
                    {source.chunkCount === 1 ? "" : "s"} · added{" "}
                    {new Date(source._creationTime).toLocaleDateString()}
                  </p>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {source.preview || "No preview available."}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void handleDelete(source._id)}
                  disabled={deletingDocumentId === source._id}
                >
                  <Trash2 className="size-4" />
                  {deletingDocumentId === source._id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedSourceId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSourceId(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
          <div className="flex max-h-[85vh] flex-col">
            <DialogHeader className="border-b px-6 py-5">
              <DialogTitle>
                {selectedSource?.name ?? "Loading source..."}
              </DialogTitle>
              <DialogDescription>
                {selectedSource
                  ? `${selectedSource.chunkCount} chunk${selectedSource.chunkCount === 1 ? "" : "s"} · added ${new Date(selectedSource._creationTime).toLocaleDateString()}`
                  : "Loading parsed source content."}
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto px-6 py-5">
              {selectedSource === undefined ? (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  Loading parsed content...
                </div>
              ) : selectedSource === null ? (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  This source could not be found.
                </div>
              ) : (
                <div className="markdown-content">
                  <Markdown>{selectedSource.content}</Markdown>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
