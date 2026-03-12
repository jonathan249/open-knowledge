import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeNotebookName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export const getNotebookByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const notebook = await ctx.db
      .query("notebooks")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();

    return notebook ?? null;
  },
});

export const getNotebook = query({
  args: {
    notebookId: v.id("notebooks"),
  },
  handler: async (ctx, args) => {
    const notebook = await ctx.db.get(args.notebookId);
    return notebook ?? null;
  },
});

export const listNotebooks = query({
  args: {},
  handler: async (ctx) => {
    const notebooks = await ctx.db.query("notebooks").collect();

    return notebooks.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const createNotebook = mutation({
  args: {
    name: v.string(),
  },
  returns: v.id("notebooks"),
  handler: async (ctx, args) => {
    const normalizedName = normalizeNotebookName(args.name);

    if (!normalizedName) {
      throw new Error("Notebook name is required.");
    }

    const existingNotebook = await ctx.db
      .query("notebooks")
      .withIndex("by_name", (q) => q.eq("name", normalizedName))
      .first();

    if (existingNotebook) {
      throw new Error("A notebook with this name already exists.");
    }

    return ctx.db.insert("notebooks", {
      name: normalizedName,
    });
  },
});

export const updateNotebook = mutation({
  args: {
    notebookId: v.id("notebooks"),
    name: v.string(),
  },
  returns: v.id("notebooks"),
  handler: async (ctx, args) => {
    const normalizedName = normalizeNotebookName(args.name);

    if (!normalizedName) {
      throw new Error("Notebook name is required.");
    }

    const notebook = await ctx.db.get(args.notebookId);

    if (!notebook) {
      throw new Error("Notebook not found.");
    }

    const conflictingNotebook = await ctx.db
      .query("notebooks")
      .withIndex("by_name", (q) => q.eq("name", normalizedName))
      .first();

    if (conflictingNotebook && conflictingNotebook._id !== args.notebookId) {
      throw new Error("A notebook with this name already exists.");
    }

    await ctx.db.patch(args.notebookId, {
      name: normalizedName,
    });

    return args.notebookId;
  },
});

export const deleteNotebook = mutation({
  args: {
    notebookId: v.id("notebooks"),
  },
  returns: v.id("notebooks"),
  handler: async (ctx, args) => {
    const notebook = await ctx.db.get(args.notebookId);

    if (!notebook) {
      throw new Error("Notebook not found.");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", args.notebookId))
      .collect();

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_notebook", (q) => q.eq("notebookId", args.notebookId))
      .collect();

    for (const document of documents) {
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_documentId", (q) => q.eq("documentId", document._id))
        .collect();

      for (const chunk of chunks) {
        const embeddings = await ctx.db
          .query("embeddings")
          .withIndex("by_chunkId", (q) => q.eq("chunkId", chunk._id))
          .collect();

        for (const embedding of embeddings) {
          await ctx.db.delete(embedding._id);
        }

        await ctx.db.delete(chunk._id);
      }

      await ctx.db.delete(document._id);
    }

    for (const message of messages) {
      const messageChunks = await ctx.db
        .query("messageChunks")
        .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
        .collect();

      for (const chunk of messageChunks) {
        await ctx.db.delete(chunk._id);
      }

      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.notebookId);

    return args.notebookId;
  },
});

export const ensureNotebook = mutation({
  args: {
    name: v.string(),
  },
  returns: v.id("notebooks"),
  handler: async (ctx, args) => {
    const normalizedName = normalizeNotebookName(args.name);
    const existingNotebook = await ctx.db
      .query("notebooks")
      .withIndex("by_name", (q) => q.eq("name", normalizedName))
      .first();

    if (existingNotebook) {
      return existingNotebook._id;
    }

    return ctx.db.insert("notebooks", {
      name: normalizedName,
    });
  },
});
