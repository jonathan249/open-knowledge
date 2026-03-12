import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { type ModelMessage, streamText } from "ai";
import { v } from "convex/values";

const MIN_CHUNK_SIZE = 20;
const FLUSH_INTERVAL = 200;
const MAX_BUFFER_SIZE = MIN_CHUNK_SIZE * 2;

type MessageWithChunks = Doc<"messages"> & {
  messageChunks: Doc<"messageChunks">[];
  sourceDocuments: Doc<"documents">[];
};

type RelevantSource = {
  embeddingId: Doc<"embeddings">["_id"];
  chunkId: Doc<"chunks">["_id"];
  documentId: Doc<"documents">["_id"];
  documentName: string;
  text: string;
  score: number;
};

export const generateAssistantMessage = internalAction({
  args: {
    notebookId: v.id("notebooks"),
    assistantMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    try {
      const messages: MessageWithChunks[] = await ctx.runQuery(
        api.messages.getMessages,
        {
          notebookId: args.notebookId,
        },
      );

      const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")
        ?.messageChunks.map((chunk) => chunk.content)
        .join("")
        .trim();

      const relevantSources: RelevantSource[] = lastUserMessage
        ? await ctx.runAction(internal.sources.searchRelevantChunks, {
            notebookId: args.notebookId,
            query: lastUserMessage,
            limit: 6,
          })
        : [];

      const sourceDocumentIds: Doc<"documents">["_id"][] = Array.from(
        new Set(relevantSources.map((source) => source.documentId)),
      );

      await ctx.runMutation(api.messages.setMessageSources, {
        messageId: args.assistantMessageId,
        sourceDocumentIds,
      });

      const fullPrompt: ModelMessage[] = messages
        .filter((message) => message._id !== args.assistantMessageId)
        .map((message) => ({
          role: message.role,
          content: message.messageChunks.map((chunk) => chunk.content).join(""),
        }))
        .filter((message) => message.content.trim().length > 0);

      const sourceContext =
        relevantSources.length > 0
          ? relevantSources
              .map((source, index) =>
                [
                  `Source ${index + 1}: ${source.documentName}`,
                  source.text,
                ].join("\n\n"),
              )
              .join("\n\n---\n\n")
          : "No relevant sources were found for this notebook.";

      const result = streamText({
        model: "google/gemini-2.0-flash-lite",
        system: [
          "You are a helpful assistant for answering questions about the content in the notebook.",
          "Use the provided source context whenever it is relevant.",
          "If the answer cannot be supported by the source context, say that you could not find supporting information in the uploaded sources.",
          "Do not append a 'Sources' section or list source document names in the message body. Source references are shown separately in the UI.",
          "Source context:",
          sourceContext,
        ].join("\n\n"),
        messages: fullPrompt,
      });

      let buffer = "";
      let lastFlushTime = Date.now();
      let flushTimeout: ReturnType<typeof setTimeout> | null = null;

      const flush = async (force = false) => {
        if (
          !force &&
          (buffer.length < MIN_CHUNK_SIZE ||
            Date.now() - lastFlushTime < FLUSH_INTERVAL)
        ) {
          return;
        }

        if (buffer.length === 0) {
          return;
        }

        const contentToFlush = buffer;
        buffer = "";
        flushTimeout = null;
        lastFlushTime = Date.now();

        try {
          await ctx.runMutation(api.messages.createMessageChunk, {
            messageId: args.assistantMessageId,
            content: contentToFlush,
          });
        } catch (error) {
          console.error("Failed to save message chunk:", error);
          buffer = contentToFlush + buffer;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await flush(true);
        }
      };

      for await (const chunk of result.textStream) {
        if (!chunk) {
          continue;
        }

        buffer += chunk;

        if (!flushTimeout) {
          flushTimeout = setTimeout(() => {
            void flush();
          }, FLUSH_INTERVAL);
        }

        if (buffer.length >= MAX_BUFFER_SIZE) {
          if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
          }

          await flush(true);
        }
      }

      if (flushTimeout) {
        clearTimeout(flushTimeout);
      }

      await flush(true);

      await ctx.runMutation(api.messages.updateMessage, {
        messageId: args.assistantMessageId,
        isComplete: true,
      });
    } catch (error) {
      console.error("Error in generateAssistantMessage:", error);

      await ctx.runMutation(api.messages.createMessageChunk, {
        messageId: args.assistantMessageId,
        content:
          "\n\nI hit an error while generating this response. Please try again.",
      });

      await ctx.runMutation(api.messages.updateMessage, {
        messageId: args.assistantMessageId,
        isComplete: true,
      });

      throw error;
    }
  },
});
