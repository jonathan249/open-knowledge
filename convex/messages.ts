import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

export const startChatMessagePair = action({
  args: {
    notebookId: v.id("notebooks"),
    content: v.string(),
    allowGeneralKnowledge: v.optional(v.boolean()),
    selectedSourceDocumentIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.object({
    assistantMessageId: v.id("messages"),
  }),
  handler: async (
    ctx,
    { notebookId, content, allowGeneralKnowledge, selectedSourceDocumentIds },
  ): Promise<{ assistantMessageId: Id<"messages"> }> => {
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      throw new Error("Message content cannot be empty.");
    }

    await ctx.runMutation(api.messages.createMessage, {
      notebookId,
      content: trimmedContent,
      role: "user",
      isComplete: true,
    });

    const assistantMessageId: Id<"messages"> = await ctx.runMutation(
      api.messages.createMessage,
      {
        notebookId,
        role: "assistant",
        isComplete: false,
      },
    );

    await ctx.scheduler.runAfter(0, internal.llm.generateAssistantMessage, {
      notebookId,
      assistantMessageId,
      allowGeneralKnowledge: allowGeneralKnowledge ?? false,
      selectedSourceDocumentIds,
    });

    return { assistantMessageId };
  },
});

export const createMessage = mutation({
  args: {
    notebookId: v.id("notebooks"),
    content: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    isComplete: v.boolean(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const newMessageId = await ctx.db.insert("messages", {
      notebookId: args.notebookId,
      role: args.role,
      isComplete: args.isComplete,
      sourceDocumentIds: [],
    });

    if (args.content && args.content.length > 0) {
      await ctx.db.insert("messageChunks", {
        messageId: newMessageId,
        content: args.content,
      });
    }

    return newMessageId;
  },
});

export const createMessageChunk = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.content) {
      return;
    }

    await ctx.db.insert("messageChunks", {
      messageId: args.messageId,
      content: args.content,
    });
  },
});

export const getMessages = query({
  args: {
    notebookId: v.id("notebooks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const baseQuery = ctx.db
      .query("messages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", args.notebookId))
      .order("desc");

    const messages = await (args.limit
      ? baseQuery.take(args.limit)
      : baseQuery.collect());
    messages.reverse();

    return Promise.all(
      messages.map(async (message) => {
        const messageChunks = await ctx.db
          .query("messageChunks")
          .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
          .order("asc")
          .collect();

        const sourceDocuments = await Promise.all(
          (message.sourceDocumentIds ?? []).map((documentId) =>
            ctx.db.get(documentId),
          ),
        );

        return {
          ...message,
          messageChunks,
          sourceDocuments: sourceDocuments.filter(
            (document) => document !== null,
          ),
        };
      }),
    );
  },
});

export const setMessageSources = mutation({
  args: {
    messageId: v.id("messages"),
    sourceDocumentIds: v.array(v.id("documents")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      sourceDocumentIds: args.sourceDocumentIds,
    });
  },
});

export const updateMessage = mutation({
  args: {
    messageId: v.id("messages"),
    isComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      isComplete: args.isComplete,
    });
  },
});
