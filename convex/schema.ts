import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  notebooks: defineTable({
    name: v.string(),
  }).index("by_name", ["name"]),
  messageChunks: defineTable({
    content: v.string(),
    messageId: v.id("messages"),
  }).index("by_messageId", ["messageId"]),
  messages: defineTable({
    isComplete: v.boolean(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    notebookId: v.id("notebooks"),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  }).index("by_notebook", ["notebookId"]),
  embeddings: defineTable({
    notebookId: v.id("notebooks"),
    embedding: v.array(v.float64()),
    chunkId: v.id("chunks"),
  })
    .index("by_notebookId", ["notebookId"])
    .index("by_chunkId", ["chunkId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["notebookId"],
    }),
  chunks: defineTable({
    documentId: v.id("documents"),
    text: v.string(),
    embeddingId: v.union(v.id("embeddings"), v.null()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    section: v.optional(v.string()),
    chunkType: v.optional(
      v.union(
        v.literal("heading"),
        v.literal("paragraph"),
        v.literal("list"),
        v.literal("table"),
        v.literal("code"),
      ),
    ),
  })
    .index("by_documentId", ["documentId"])
    .index("by_embeddingId", ["embeddingId"]),
  documents: defineTable({
    notebookId: v.id("notebooks"),
    name: v.string(),
    content: v.string(),
  })
    .index("by_notebook", ["notebookId"])
    .index("by_notebook_and_name", ["notebookId", "name"]),
});
