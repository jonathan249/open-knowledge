import { embed, embedMany } from "ai";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const CHUNK_TARGET_LENGTH = 1200;
const CHUNK_OVERLAP = 200;
const MINIMUM_VECTOR_SCORE = 0.55;
const FALLBACK_RESULT_LIMIT = 3;

function normalizeSourceName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeMarkdown(content: string) {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function splitOversizedBlock(block: string) {
  const segments: string[] = [];
  let start = 0;

  while (start < block.length) {
    let end = Math.min(start + CHUNK_TARGET_LENGTH, block.length);

    if (end < block.length) {
      const sentenceBoundary = Math.max(
        block.lastIndexOf("\n", end),
        block.lastIndexOf(". ", end),
        block.lastIndexOf(" ", end),
      );

      if (sentenceBoundary > start + Math.floor(CHUNK_TARGET_LENGTH * 0.6)) {
        end = sentenceBoundary + 1;
      }
    }

    const segment = block.slice(start, end).trim();
    if (segment.length > 0) {
      segments.push(segment);
    }

    if (end >= block.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return segments;
}

function chunkMarkdown(content: string) {
  const normalized = normalizeMarkdown(content);
  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const chunks: string[] = [];
  let currentChunk = "";

  for (const block of blocks) {
    if (block.length > CHUNK_TARGET_LENGTH) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      chunks.push(...splitOversizedBlock(block));
      continue;
    }

    const candidateChunk = currentChunk ? `${currentChunk}\n\n${block}` : block;

    if (candidateChunk.length <= CHUNK_TARGET_LENGTH) {
      currentChunk = candidateChunk;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = block;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

type SourceChunkPayload = {
  text: string;
  embedding: number[];
};

type HydratedSearchResult = {
  embeddingId: Id<"embeddings">;
  chunkId: Id<"chunks">;
  documentId: Id<"documents">;
  documentName: string;
  text: string;
};

type RelevantChunkResult = HydratedSearchResult & {
  score: number;
};

export const listSources = query({
  args: {
    notebookId: v.id("notebooks"),
  },
  handler: async (ctx, args) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_notebook", (q) => q.eq("notebookId", args.notebookId))
      .collect();

    const sources = await Promise.all(
      documents.map(async (document) => {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("by_documentId", (q) => q.eq("documentId", document._id))
          .collect();

        return {
          _id: document._id,
          _creationTime: document._creationTime,
          name: document.name,
          preview: document.content.slice(0, 220),
          chunkCount: chunks.length,
        };
      }),
    );

    return sources.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const getSource = query({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.union(
    v.object({
      _id: v.id("documents"),
      _creationTime: v.number(),
      name: v.string(),
      content: v.string(),
      chunkCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);

    if (!document) {
      return null;
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", document._id))
      .collect();

    return {
      _id: document._id,
      _creationTime: document._creationTime,
      name: document.name,
      content: document.content,
      chunkCount: chunks.length,
    };
  },
});

export const deleteSource = mutation({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);

    if (!document) {
      throw new Error("Source not found.");
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", args.documentId))
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

    await ctx.db.delete(args.documentId);

    return args.documentId;
  },
});

export const ingestMarkdownSource = action({
  args: {
    notebookId: v.id("notebooks"),
    name: v.string(),
    content: v.string(),
  },
  returns: v.object({
    documentId: v.id("documents"),
    chunkCount: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ documentId: Id<"documents">; chunkCount: number }> => {
    const normalizedName = normalizeSourceName(args.name);
    const normalizedContent = normalizeMarkdown(args.content);

    if (!normalizedName) {
      throw new Error("Source name is required.");
    }

    if (!normalizedContent) {
      throw new Error("Source content is empty.");
    }

    const chunks = chunkMarkdown(normalizedContent);

    if (chunks.length === 0) {
      throw new Error("Could not create chunks from this source.");
    }

    const { embeddings } = await embedMany({
      model: EMBEDDING_MODEL,
      values: chunks,
      maxParallelCalls: 4,
    });

    const sourceChunks: SourceChunkPayload[] = embeddings.map(
      (embedding, index) => ({
        text: chunks[index],
        embedding,
      }),
    );

    return ctx.runMutation(internal.sources.upsertDocumentWithEmbeddings, {
      notebookId: args.notebookId,
      name: normalizedName,
      content: normalizedContent,
      chunks: sourceChunks,
    });
  },
});

export const searchRelevantChunks = internalAction({
  args: {
    notebookId: v.id("notebooks"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      embeddingId: v.id("embeddings"),
      chunkId: v.id("chunks"),
      documentId: v.id("documents"),
      documentName: v.string(),
      text: v.string(),
      score: v.number(),
    }),
  ),
  handler: async (ctx, args): Promise<RelevantChunkResult[]> => {
    const normalizedQuery = args.query.trim();

    if (!normalizedQuery) {
      return [];
    }

    const { embedding } = await embed({
      model: EMBEDDING_MODEL,
      value: normalizedQuery,
    });

    const results = await ctx.vectorSearch("embeddings", "by_embedding", {
      vector: embedding,
      limit: args.limit ?? 6,
      filter: (q) => q.eq("notebookId", args.notebookId),
    });

    const hydratedResults: HydratedSearchResult[] = await ctx.runQuery(
      internal.sources.loadSearchResults,
      {
        embeddingIds: results.map((result) => result._id),
      },
    );

    const scoreByEmbeddingId = new Map(
      results.map((result) => [result._id, result._score]),
    );

    const scoredResults = hydratedResults.map(
      (result): RelevantChunkResult => ({
        ...result,
        score: scoreByEmbeddingId.get(result.embeddingId) ?? 0,
      }),
    );

    const thresholdMatches = scoredResults.filter(
      (result) => result.score >= MINIMUM_VECTOR_SCORE,
    );

    if (thresholdMatches.length > 0) {
      return thresholdMatches;
    }

    return scoredResults
      .filter((result) => result.score > 0)
      .slice(0, FALLBACK_RESULT_LIMIT);
  },
});

export const loadSearchResults = internalQuery({
  args: {
    embeddingIds: v.array(v.id("embeddings")),
  },
  returns: v.array(
    v.object({
      embeddingId: v.id("embeddings"),
      chunkId: v.id("chunks"),
      documentId: v.id("documents"),
      documentName: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const results: HydratedSearchResult[] = [];

    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId);
      if (!embedding) {
        continue;
      }

      const chunk = await ctx.db.get(embedding.chunkId);
      if (!chunk) {
        continue;
      }

      const document = await ctx.db.get(chunk.documentId);
      if (!document) {
        continue;
      }

      results.push({
        embeddingId,
        chunkId: chunk._id,
        documentId: document._id,
        documentName: document.name,
        text: chunk.text,
      });
    }

    return results;
  },
});

export const upsertDocumentWithEmbeddings = internalMutation({
  args: {
    notebookId: v.id("notebooks"),
    name: v.string(),
    content: v.string(),
    chunks: v.array(
      v.object({
        text: v.string(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  returns: v.object({
    documentId: v.id("documents"),
    chunkCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const existingDocument = await ctx.db
      .query("documents")
      .withIndex("by_notebook_and_name", (q) =>
        q.eq("notebookId", args.notebookId).eq("name", args.name),
      )
      .unique();

    let documentId: Id<"documents">;

    if (existingDocument) {
      documentId = existingDocument._id;

      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_documentId", (q) => q.eq("documentId", documentId))
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

      await ctx.db.patch(documentId, {
        content: args.content,
        name: args.name,
      });
    } else {
      documentId = await ctx.db.insert("documents", {
        notebookId: args.notebookId,
        name: args.name,
        content: args.content,
      });
    }

    for (const chunk of args.chunks) {
      const chunkId = await ctx.db.insert("chunks", {
        documentId,
        text: chunk.text,
        embeddingId: null,
      });

      const embeddingId = await ctx.db.insert("embeddings", {
        notebookId: args.notebookId,
        chunkId,
        embedding: chunk.embedding,
      });

      await ctx.db.patch(chunkId, {
        embeddingId,
      });
    }

    return {
      documentId,
      chunkCount: args.chunks.length,
    };
  },
});
