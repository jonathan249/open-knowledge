import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { tool, type ModelMessage, streamText } from "ai";
import { v } from "convex/values";
import { z } from "zod";

const MIN_CHUNK_SIZE = 20;
const FLUSH_INTERVAL = 200;
const MAX_BUFFER_SIZE = MIN_CHUNK_SIZE * 2;
const TOOL_RESULT_SNIPPET_LENGTH = 1200;

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
    "You are a notebook tutor assistant. Your goal is to teach clearly, not just answer quickly.",
    "Explain ideas in a step-by-step, beginner-friendly way first, then add deeper detail when useful.",
    "Prefer clear structure: start with a direct answer, then explain why, then show how or with an example.",
    "Define important terms in plain language before using technical jargon.",
    "When the user asks for process, guidance, or troubleshooting, provide actionable steps they can follow.",
    "When making factual claims from notebook context, add inline citations like [S1], [S2] near the relevant sentence.",
    "Do not invent citations and do not cite sources that are not provided.",
    "If the initial source context is insufficient, call the searchSources tool to fetch additional notebook evidence before answering.",
    "If evidence is partial, clearly separate: (a) what is supported by notebook sources and (b) what is inference.",
    groundingInstruction,
    "If sources conflict, explicitly acknowledge the conflict, explain both sides, and cite each conflicting source.",
    "If the user asks for a recommendation, give one with reasoning and note tradeoffs.",
    "Keep answers concise when the question is simple, but be thorough and explanatory for complex questions.",
    "Do not append a separate 'Sources' section at the end.",
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
      const sourceDocumentIdSet = new Set<Doc<"documents">["_id"]>(
        relevantSources.map((source) => source.documentId),
      );

      const fullPrompt: ModelMessage[] = messages
        .filter((message) => message._id !== args.assistantMessageId)
        .map((message) => ({
          role: message.role,
          content: message.messageChunks.map((chunk) => chunk.content).join(""),
        }))
        .filter((message) => message.content.trim().length > 0);

      const sourceContext = formatSourceContext(relevantSources);
      let toolUsageCount = 0;
      const result = streamText({
        model: "google/gemini-3.1-flash-lite-preview",
        system: buildSystemPrompt(sourceContext, args.allowGeneralKnowledge),
        messages: fullPrompt,
        tools: {
          searchSources: tool({
            description:
              "Search uploaded notebook sources for semantically relevant chunks to support factual claims.",
            inputSchema: z.object({
              query: z
                .string()
                .min(1)
                .max(500)
                .describe("Natural language query to run against notebook sources."),
              limit: z
                .number()
                .int()
                .min(1)
                .max(6)
                .optional()
                .describe("Maximum number of snippets to return."),
            }),
            execute: async ({ query, limit }) => {
              toolUsageCount += 1;
              const normalizedQuery = query.trim();
              if (!normalizedQuery) {
                return { results: [] };
              }

              const matches: RelevantSource[] = await ctx.runAction(
                internal.sources.searchRelevantChunks,
                {
                  notebookId: args.notebookId,
                  query: normalizedQuery,
                  limit: limit ?? 4,
                  selectedSourceDocumentIds: args.selectedSourceDocumentIds,
                },
              );

              for (const match of matches) {
                sourceDocumentIdSet.add(match.documentId);
              }

              return {
                results: matches.map((match) => ({
                  documentId: match.documentId,
                  documentName: match.documentName,
                  pageStart: match.pageStart,
                  pageEnd: match.pageEnd,
                  section: match.section,
                  chunkType: match.chunkType,
                  relevance: Number(match.score.toFixed(3)),
                  snippet: match.text.trim().slice(0, TOOL_RESULT_SNIPPET_LENGTH),
                })),
              };
            },
          }),
        },
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

      await ctx.runMutation(api.messages.setMessageSources, {
        messageId: args.assistantMessageId,
        sourceDocumentIds: Array.from(sourceDocumentIdSet),
      });

      await ctx.runMutation(api.messages.setMessageToolUsage, {
        messageId: args.assistantMessageId,
        toolUsageCount,
      });

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
