"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SendHorizontal, ChevronDown, Brain } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

const MESSAGE_LIMIT = 50;

export function NotebookChat({
  notebookId,
  onSourceSelect,
}: {
  notebookId: Id<"notebooks">;
  onSourceSelect?: (sourceId: Id<"documents">) => void;
}) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [allowGeneralKnowledge, setAllowGeneralKnowledge] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Id<"documents">[]>(
    [],
  );
  const [hasCustomSourceSelection, setHasCustomSourceSelection] =
    useState(false);
  const selectedSourceIdsRef = useRef<Id<"documents">[]>([]);
  const hasCustomSourceSelectionRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const startChat = useAction(api.messages.startChatMessagePair);
  const sources = useQuery(api.sources.listSources, { notebookId });

  const messages = useQuery(api.messages.getMessages, {
    notebookId,
    limit: MESSAGE_LIMIT,
  });

  const chatMessages = useMemo(
    () =>
      (messages ?? []).map((message) => ({
        ...message,
        content: message.messageChunks.map((chunk) => chunk.content).join(""),
      })),
    [messages],
  );

  const allSourceIds = useMemo(
    () => (sources ?? []).map((source) => source._id),
    [sources],
  );

  const selectedSourceCount = hasCustomSourceSelection
    ? selectedSourceIds.length
    : allSourceIds.length;
  const sourceSelectionLabel =
    allSourceIds.length === 0
      ? "No sources"
      : selectedSourceCount === allSourceIds.length
        ? "All sources"
        : `${selectedSourceCount}/${allSourceIds.length} sources`;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages]);

  useEffect(() => {
    selectedSourceIdsRef.current = selectedSourceIds;
  }, [selectedSourceIds]);

  useEffect(() => {
    hasCustomSourceSelectionRef.current = hasCustomSourceSelection;
  }, [hasCustomSourceSelection]);

  useEffect(() => {
    if (!sources) {
      return;
    }

    if (!hasCustomSourceSelection) {
      setSelectedSourceIds((current) => {
        if (
          current.length === allSourceIds.length &&
          current.every((id, index) => id === allSourceIds[index])
        ) {
          return current;
        }
        selectedSourceIdsRef.current = allSourceIds;
        return allSourceIds;
      });
      return;
    }

    const validSourceIds = new Set(allSourceIds);
    setSelectedSourceIds((current) => {
      const next = current.filter((id) => validSourceIds.has(id));
      if (next.length === current.length) {
        return current;
      }
      selectedSourceIdsRef.current = next;
      return next;
    });
  }, [allSourceIds, hasCustomSourceSelection, sources]);

  const isSourceSelected = (sourceId: Id<"documents">) =>
    !hasCustomSourceSelection || selectedSourceIds.includes(sourceId);

  const handleToggleSource = (sourceId: Id<"documents">) => {
    setSelectedSourceIds((current) => {
      const baseSelection = hasCustomSourceSelection ? current : allSourceIds;
      const hasSource = baseSelection.includes(sourceId);
      const nextSelection = hasSource
        ? baseSelection.filter((id) => id !== sourceId)
        : [...baseSelection, sourceId];

      selectedSourceIdsRef.current = nextSelection;
      return nextSelection;
    });
    setHasCustomSourceSelection(true);
    hasCustomSourceSelectionRef.current = true;
  };

  const handleSelectAllSources = () => {
    setHasCustomSourceSelection(false);
    hasCustomSourceSelectionRef.current = false;
    setSelectedSourceIds(allSourceIds);
    selectedSourceIdsRef.current = allSourceIds;
  };

  const handleClearSources = () => {
    setHasCustomSourceSelection(true);
    hasCustomSourceSelectionRef.current = true;
    setSelectedSourceIds([]);
    selectedSourceIdsRef.current = [];
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) {
      return;
    }

    setIsSending(true);

    try {
      const sourceSelectionForRequest = hasCustomSourceSelectionRef.current
        ? selectedSourceIdsRef.current
        : sources === undefined
          ? undefined
          : allSourceIds;

      await startChat({
        notebookId,
        content: trimmedInput,
        allowGeneralKnowledge,
        selectedSourceDocumentIds: sourceSelectionForRequest,
      });
      setInput("");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-160px)] flex-col">
      <section className="flex flex-1 flex-col">
        <div className="flex min-h-[60vh] flex-col overflow-y-auto pb-28">
          {chatMessages.length === 0 ? (
            <div className="m-auto max-w-xl text-center text-[#6f6f6f] dark:text-[#a1a1aa]">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black/5 text-[#171717] dark:bg-white/10 dark:text-[#f3f3ef]">
                ✨
              </div>
              <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#171717] dark:text-[#f3f3ef]">
                Ask your first notebook question
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#6f6f6f] dark:text-[#a1a1aa]">
                Start the conversation and your notebook will answer using the
                indexed sources attached to this workspace.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {chatMessages.map((message) => (
                <article
                  key={message._id}
                  className={cn(
                    "w-full",
                    message.role === "user" && "ml-auto max-w-[85%] text-right",
                  )}
                >
                  <p className="mb-1 text-sm font-normal tracking-[-0.02em] text-[#9a9a9a] dark:text-[#7a7a82]">
                    {message.role === "assistant" ? "Notebook" : "User"}
                  </p>
                  <div className="max-w-none text-sm leading-6 text-[#171717] dark:text-[#f3f3ef]">
                    <Streamdown
                      className="max-w-none [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1"
                      mode={message.isComplete ? "static" : "streaming"}
                      key={message._id}
                      animated
                      isAnimating={!message.isComplete}
                    >
                      {message.content || " "}
                    </Streamdown>
                    {message.role === "assistant" &&
                    message.isComplete &&
                    message.sourceDocuments.length > 0 ? (
                      <div className="mt-4">
                        <details className="group inline-block">
                          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-[#6f6f6f] [&::-webkit-details-marker]:hidden dark:text-[#a1a1aa]">
                            <span>Sources</span>
                            <ChevronDown className="ml-1 size-3.5 transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-2 flex-col">
                            {message.sourceDocuments.map((source) => (
                              <button
                                type="button"
                                key={source._id}
                                onClick={() => onSourceSelect?.(source._id)}
                                className={cn(
                                  "w-fit text-left font-medium underline underline-offset-4",
                                  onSourceSelect
                                    ? "cursor-pointer text-[#171717] hover:text-[#6f6f6f] dark:text-[#f3f3ef] dark:hover:text-[#a1a1aa]"
                                    : "cursor-default text-[#6f6f6f] dark:text-[#a1a1aa]",
                                )}
                              >
                                {source.name}
                              </button>
                            ))}
                          </div>
                        </details>
                      </div>
                    ) : null}
                    {!message.isComplete && (
                      <span className="mt-2 inline-block h-4 w-1 animate-pulse rounded-full bg-[#171717] align-middle dark:bg-[#f3f3ef]" />
                    )}
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="sticky bottom-0 mt-auto bg-white/95 pb-4 pt-4 backdrop-blur dark:bg-[#111111]/95"
        >
          <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
            <label className="block">
              <span className="sr-only">Message</span>
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask your notebook..."
                className="h-10 border-0 bg-transparent px-1 py-0 text-sm leading-6 text-[#171717] shadow-none outline-none ring-0 placeholder:text-[#6f6f6f] focus-visible:ring-0 dark:text-[#f3f3ef] dark:placeholder:text-[#a1a1aa]"
                disabled={isSending}
                autoComplete="off"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <details className="relative group">
                  <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-xs font-medium text-[#6f6f6f] hover:bg-[#f2f2f0] hover:text-[#171717] [&::-webkit-details-marker]:hidden dark:text-[#a1a1aa] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]">
                    <span>{sourceSelectionLabel}</span>
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="absolute bottom-10 left-0 z-30 w-72 rounded-lg border border-[#e5e5e5] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <button
                        type="button"
                        onClick={handleSelectAllSources}
                        className="text-xs font-medium text-[#6f6f6f] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:text-[#f3f3ef]"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSources}
                        className="text-xs font-medium text-[#6f6f6f] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:text-[#f3f3ef]"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {(sources ?? []).length === 0 ? (
                        <p className="px-1 py-2 text-xs text-[#6f6f6f] dark:text-[#a1a1aa]">
                          No sources uploaded.
                        </p>
                      ) : (
                        (sources ?? []).map((source) => (
                          <label
                            key={source._id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs text-[#171717] hover:bg-[#f2f2f0] dark:text-[#f3f3ef] dark:hover:bg-white/10"
                          >
                            <input
                              type="checkbox"
                              checked={isSourceSelected(source._id)}
                              onChange={() => handleToggleSource(source._id)}
                              className="size-3.5 rounded border-[#d8d8d5] text-[#171717] focus:ring-0 dark:border-white/20 dark:bg-[#111111] dark:text-[#f3f3ef]"
                            />
                            <span className="truncate">{source.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </details>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAllowGeneralKnowledge((current) => !current)}
                  className={cn(
                    "h-8 rounded-md px-2 text-xs font-medium",
                    allowGeneralKnowledge
                      ? "bg-[#171717] text-[#f3f3ef] hover:bg-[#000000] hover:text-[#f3f3ef] dark:bg-[#f3f3ef] dark:text-[#171717] dark:hover:bg-[#e7e7e2]"
                      : "text-[#6f6f6f] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#a1a1aa] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]",
                  )}
                >
                  <Brain className="size-3.5" />
                  Allgemein Wissen
                </Button>
              </div>

              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={isSending || input.trim().length === 0}
                className="size-8 rounded-md text-[#171717] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#f3f3ef] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]"
              >
                <SendHorizontal className="size-4" />
                <span className="sr-only">
                  {isSending ? "Sending message" : "Send message"}
                </span>
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
