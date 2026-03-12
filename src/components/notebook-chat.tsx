"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SendHorizontal } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

const MESSAGE_LIMIT = 50;

export function NotebookChat({ notebookId }: { notebookId: Id<"notebooks"> }) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const startChat = useAction(api.messages.startChatMessagePair);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) {
      return;
    }

    setIsSending(true);

    try {
      await startChat({
        notebookId,
        content: trimmedInput,
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
                    {/* <div className="markdown-content whitespace-pre-wrap text-[#171717] dark:text-[#f3f3ef]"> */}
                    {/* <Markdown>{message.content || " "}</Markdown> */}
                    <Streamdown
                    mode={message.isComplete ? "static" : "streaming"}
                      key={message._id}
                      animated
                      isAnimating={!message.isComplete}
                    >
                      {message.content || " "}
                    </Streamdown>
                    {/* </div> */}
                    {/* {message.role === "assistant" &&
                    message.sourceDocuments.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {message.sourceDocuments.map((source) => (
                          <span
                            key={source._id}
                            className="rounded-full border border-[#e5e5e5] bg-white px-3 py-1 text-xs font-medium text-[#6f6f6f] dark:border-white/10 dark:bg-white/5 dark:text-[#a1a1aa]"
                          >
                            {source.name}
                          </span>
                        ))}
                      </div>
                    ) : null} */}
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
          <div className="relative rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
            <label className="block">
              <span className="sr-only">Message</span>
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask your notebook..."
                className="h-10 border-0 bg-transparent px-1 py-0 pr-12 text-sm leading-6 text-[#171717] shadow-none outline-none ring-0 placeholder:text-[#6f6f6f] focus-visible:ring-0 dark:text-[#f3f3ef] dark:placeholder:text-[#a1a1aa]"
                disabled={isSending}
                autoComplete="off"
              />
            </label>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isSending || input.trim().length === 0}
              className="absolute bottom-3 right-3 size-8 rounded-md text-[#171717] hover:bg-[#f2f2f0] hover:text-[#171717] dark:text-[#f3f3ef] dark:hover:bg-white/10 dark:hover:text-[#f3f3ef]"
            >
              <SendHorizontal className="size-4" />
              <span className="sr-only">
                {isSending ? "Sending message" : "Send message"}
              </span>
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
