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
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  chunkType?: "heading" | "paragraph" | "list" | "table" | "code";
  score: number;
  vectorScore: number;
  keywordScore: number;
};

function formatSourceContext(sources: RelevantSource[]) {
  if (sources.length === 0) {
    return "No relevant sources were found for this notebook.";
  }

  return sources
    .map((source, index) => {
      const sourceId = `S${index + 1}`;
      const pageLabel =
        source.pageStart !== undefined
          ? source.pageEnd && source.pageEnd !== source.pageStart
            ? `Pages ${source.pageStart}-${source.pageEnd}`
            : `Page ${source.pageStart}`
          : "Page unknown";

      const metadataLine = [
        `[${sourceId}]`,
        `Document: ${source.documentName}`,
        pageLabel,
        source.section ? `Section: ${source.section}` : null,
        source.chunkType ? `Type: ${source.chunkType}` : null,
        `Relevance: ${source.score.toFixed(3)}`,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" | ");

      const snippet = source.text.trim().slice(0, 1800);
      return [metadataLine, snippet].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildSystemPrompt(
  sourceContext: string,
  allowGeneralKnowledge: boolean,
) {
  const groundingInstruction = allowGeneralKnowledge
    ? "You may use general world knowledge when sources are missing, but clearly label those statements as '(general knowledge)' and keep source-grounded statements prioritized."
    : "If support is missing or weak, explicitly say you could not find supporting information in the uploaded sources.";

  return [
    "You are a notebook assistant. Answer with high factual precision and only use supported context.",
    "When making factual claims from context, add inline citations like [S1], [S2].",
    "Do not invent citations and do not cite sources that are not provided.",
    groundingInstruction,
    "Do not append a separate 'Sources' section at the end.",
    "If multiple sources conflict, acknowledge the conflict and cite both.",
    "Source context:",
    sourceContext,
  ].join("\n\n");
}

export const generateAssistantMessage = internalAction({
  args: {
    notebookId: v.id("notebooks"),
    assistantMessageId: v.id("messages"),
    allowGeneralKnowledge: v.boolean(),
    selectedSourceDocumentIds: v.optional(v.array(v.id("documents"))),
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
        ? args.selectedSourceDocumentIds &&
          args.selectedSourceDocumentIds.length === 0
          ? []
          : await ctx.runAction(internal.sources.searchRelevantChunks, {
              notebookId: args.notebookId,
              query: lastUserMessage,
              limit: 6,
              selectedSourceDocumentIds: args.selectedSourceDocumentIds,
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

      const sourceContext = formatSourceContext(relevantSources);
      const result = streamText({
        model: "google/gemini-3-flash",
        system: buildSystemPrompt(sourceContext, args.allowGeneralKnowledge),
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
