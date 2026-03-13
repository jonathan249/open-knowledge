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
const CHUNK_TARGET_LENGTH = 900;
const CHUNK_OVERLAP = 140;
const MIN_CHUNK_SIZE = 80;
const RETRIEVAL_CANDIDATE_MULTIPLIER = 4;
const MINIMUM_HYBRID_SCORE = 0.32;

type ChunkType = "heading" | "paragraph" | "list" | "table" | "code";

type ChunkMetadata = {
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  chunkType: ChunkType;
};

type SemanticBlock = {
  text: string;
  metadata: ChunkMetadata;
};

type SourceChunkPayload = {
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
};

type HydratedSearchResult = {
  embeddingId: Id<"embeddings">;
  chunkId: Id<"chunks">;
  documentId: Id<"documents">;
  documentName: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  chunkType?: ChunkType;
};

type RelevantChunkResult = HydratedSearchResult & {
  score: number;
  vectorScore: number;
  keywordScore: number;
};

const QUERY_EXPANSION_RULES: Array<{ pattern: RegExp; expansion: string }> = [
  { pattern: /\brevenue\b/i, expansion: "income sales turnover" },
  { pattern: /\bprofit\b/i, expansion: "margin earnings net income" },
  { pattern: /\bexpenses?\b/i, expansion: "cost spending expenditure" },
  { pattern: /\bq([1-4])\b/i, expansion: "quarter quarterly results" },
  { pattern: /\byoy\b/i, expansion: "year over year annual comparison" },
  { pattern: /\busd\b/i, expansion: "dollar $" },
];

const KEYWORD_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

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
    .replace(/\ufb01/g, "fi")
    .replace(/\ufb02/g, "fl")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .normalize("NFKC")
    .trim();
}

function tokenizeForKeywordSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !KEYWORD_STOPWORDS.has(token));
}

function expandQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const expansions = new Set<string>([normalized]);

  for (const rule of QUERY_EXPANSION_RULES) {
    if (rule.pattern.test(normalized)) {
      expansions.add(rule.expansion);
    }
  }

  const quarterMatch = normalized.match(/\bq([1-4])\b/i);
  if (quarterMatch?.[1]) {
    expansions.add(`Q${quarterMatch[1]} quarter ${quarterMatch[1]}`);
  }

  return [...expansions].join(" ");
}

function keywordOverlapScore(queryTokens: string[], text: string) {
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(tokenizeForKeywordSearch(text));
  if (candidateTokens.size === 0) {
    return 0;
  }

  let matchedTokenCount = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      matchedTokenCount += 1;
    }
  }

  return matchedTokenCount / queryTokens.length;
}

function normalizeFingerprint(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function classifyBlockType(block: string): ChunkType {
  const trimmed = block.trim();
  if (!trimmed) {
    return "paragraph";
  }

  if (trimmed.startsWith("```") || trimmed.includes("\n```")) {
    return "code";
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 0 && lines.every((line) => /^\|.*\|$/.test(line))) {
    return "table";
  }

  if (
    lines.length > 0 &&
    lines.every((line) => /^([-*+]\s+|\d+[.)]\s+)/.test(line))
  ) {
    return "list";
  }

  return "paragraph";
}

function splitOversizedBlock(block: string) {
  const segments: string[] = [];
  let start = 0;

  while (start < block.length) {
    let end = Math.min(start + CHUNK_TARGET_LENGTH, block.length);

    if (end < block.length) {
      const preferredBoundary = Math.max(
        block.lastIndexOf("\n\n", end),
        block.lastIndexOf("\n", end),
        block.lastIndexOf(". ", end),
        block.lastIndexOf("? ", end),
        block.lastIndexOf("! ", end),
        block.lastIndexOf("; ", end),
        block.lastIndexOf(" ", end),
      );

      if (preferredBoundary > start + Math.floor(CHUNK_TARGET_LENGTH * 0.55)) {
        end = preferredBoundary + 1;
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

function buildSemanticBlocks(content: string) {
  const normalized = normalizeMarkdown(content);
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const blocks: SemanticBlock[] = [];
  const headingStack: string[] = [];
  const pageMarker = /^##\s+Page\s+(\d+)\s*$/i;
  const headingPattern = /^(#{1,6})\s+(.+)$/;

  let currentPage = 1;
  let buffer: string[] = [];
  let bufferPage = currentPage;

  const flushBuffer = () => {
    const text = buffer.join("\n").trim();
    buffer = [];

    if (!text) {
      return;
    }

    blocks.push({
      text,
      metadata: {
        pageStart: bufferPage,
        pageEnd: currentPage,
        section:
          headingStack.length > 0
            ? headingStack.join(" > ").replace(/\s+/g, " ").trim()
            : undefined,
        chunkType: classifyBlockType(text),
      },
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const pageMatch = trimmed.match(pageMarker);

    if (pageMatch) {
      flushBuffer();
      currentPage = Number.parseInt(pageMatch[1] ?? "1", 10) || currentPage;
      continue;
    }

    const headingMatch = trimmed.match(headingPattern);
    if (headingMatch) {
      flushBuffer();
      const level = headingMatch[1]?.length ?? 1;
      const heading = headingMatch[2]?.trim();

      if (heading) {
        headingStack.splice(level - 1);
        headingStack[level - 1] = heading;
      }
      continue;
    }

    if (!trimmed) {
      flushBuffer();
      continue;
    }

    if (buffer.length === 0) {
      bufferPage = currentPage;
    }
    buffer.push(line);
  }

  flushBuffer();
  return blocks;
}

function canMergeChunks(previous: SemanticBlock, next: SemanticBlock) {
  if (previous.metadata.chunkType !== next.metadata.chunkType) {
    return false;
  }

  if (
    previous.metadata.chunkType === "code" ||
    previous.metadata.chunkType === "table"
  ) {
    return false;
  }

  return (
    previous.metadata.section === next.metadata.section &&
    previous.metadata.pageEnd === next.metadata.pageStart
  );
}

function chunkMarkdown(content: string) {
  const blocks = buildSemanticBlocks(content);
  if (blocks.length === 0) {
    return [];
  }

  const expandedBlocks: SemanticBlock[] = [];

  for (const block of blocks) {
    if (block.text.length <= CHUNK_TARGET_LENGTH) {
      expandedBlocks.push(block);
      continue;
    }

    for (const segment of splitOversizedBlock(block.text)) {
      expandedBlocks.push({
        text: segment,
        metadata: { ...block.metadata },
      });
    }
  }

  const chunks: SemanticBlock[] = [];

  for (const block of expandedBlocks) {
    const previousChunk = chunks.at(-1);

    if (
      previousChunk &&
      canMergeChunks(previousChunk, block) &&
      previousChunk.text.length + 2 + block.text.length <= CHUNK_TARGET_LENGTH
    ) {
      previousChunk.text = `${previousChunk.text}\n\n${block.text}`.trim();
      previousChunk.metadata.pageEnd = block.metadata.pageEnd;
      continue;
    }

    chunks.push({
      text: block.text.trim(),
      metadata: { ...block.metadata },
    });
  }

  return chunks.filter(
    (chunk) =>
      chunk.text.length >= MIN_CHUNK_SIZE ||
      chunk.metadata.chunkType === "table" ||
      chunk.metadata.chunkType === "list",
  );
}

function buildEmbeddingInput(chunk: SemanticBlock) {
  const metadataLines = [
    chunk.metadata.section ? `Section: ${chunk.metadata.section}` : null,
    chunk.metadata.pageStart ? `Page: ${chunk.metadata.pageStart}` : null,
    `Type: ${chunk.metadata.chunkType}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return [metadataLines, chunk.text].join("\n\n").trim();
}

function chunkTypeValidator() {
  return v.union(
    v.literal("heading"),
    v.literal("paragraph"),
    v.literal("list"),
    v.literal("table"),
    v.literal("code"),
  );
}

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
      throw new Error("Could not create semantic chunks from this source.");
    }

    const embeddingInputs = chunks.map((chunk) => buildEmbeddingInput(chunk));
    const { embeddings } = await embedMany({
      model: EMBEDDING_MODEL,
      values: embeddingInputs,
      maxParallelCalls: 4,
    });

    const sourceChunks: SourceChunkPayload[] = embeddings.map(
      (embedding, index) => ({
        text: chunks[index]?.text ?? "",
        embedding,
        metadata: chunks[index]?.metadata ?? {
          chunkType: "paragraph",
        },
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
    selectedSourceDocumentIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.array(
    v.object({
      embeddingId: v.id("embeddings"),
      chunkId: v.id("chunks"),
      documentId: v.id("documents"),
      documentName: v.string(),
      text: v.string(),
      pageStart: v.optional(v.number()),
      pageEnd: v.optional(v.number()),
      section: v.optional(v.string()),
      chunkType: v.optional(chunkTypeValidator()),
      score: v.number(),
      vectorScore: v.number(),
      keywordScore: v.number(),
    }),
  ),
  handler: async (ctx, args): Promise<RelevantChunkResult[]> => {
    const normalizedQuery = args.query.trim();

    if (!normalizedQuery) {
      return [];
    }

    const limit = Math.max(1, args.limit ?? 6);
    const expandedQuery = expandQuery(normalizedQuery);
    const queryTokens = tokenizeForKeywordSearch(expandedQuery);
    const candidateLimit = Math.max(limit * RETRIEVAL_CANDIDATE_MULTIPLIER, 12);
    const allowedDocumentIds = args.selectedSourceDocumentIds
      ? new Set(args.selectedSourceDocumentIds.map(String))
      : null;

    if (allowedDocumentIds && allowedDocumentIds.size === 0) {
      return [];
    }

    const { embedding } = await embed({
      model: EMBEDDING_MODEL,
      value: expandedQuery,
    });

    const vectorResults = await ctx.vectorSearch("embeddings", "by_embedding", {
      vector: embedding,
      limit: candidateLimit,
      filter: (q) => q.eq("notebookId", args.notebookId),
    });

    if (vectorResults.length === 0) {
      return [];
    }

    const hydratedResults: HydratedSearchResult[] = await ctx.runQuery(
      internal.sources.loadSearchResults,
      {
        embeddingIds: vectorResults.map((result) => result._id),
      },
    );
    const filteredHydratedResults = allowedDocumentIds
      ? hydratedResults.filter((result) =>
          allowedDocumentIds.has(String(result.documentId)),
        )
      : hydratedResults;

    if (filteredHydratedResults.length === 0) {
      return [];
    }

    const vectorScoreByEmbeddingId = new Map(
      vectorResults.map((result) => [result._id, result._score]),
    );

    const scoredCandidates = filteredHydratedResults
      .map(
        (result): RelevantChunkResult => {
          const vectorScore = vectorScoreByEmbeddingId.get(result.embeddingId) ?? 0;
          const keywordScore = keywordOverlapScore(queryTokens, result.text);
          const score = vectorScore * 0.82 + keywordScore * 0.18;

          return {
            ...result,
            score,
            vectorScore,
            keywordScore,
          };
        },
      )
      .sort((left, right) => right.score - left.score);

    const dedupedCandidates: RelevantChunkResult[] = [];
    const seenFingerprints = new Set<string>();

    for (const candidate of scoredCandidates) {
      const fingerprint = `${candidate.documentId}:${normalizeFingerprint(candidate.text).slice(0, 220)}`;
      if (seenFingerprints.has(fingerprint)) {
        continue;
      }
      seenFingerprints.add(fingerprint);
      dedupedCandidates.push(candidate);
    }

    if (dedupedCandidates.length === 0) {
      return [];
    }

    const topScore = dedupedCandidates[0]?.score ?? 0;
    const dynamicThreshold = Math.max(MINIMUM_HYBRID_SCORE, topScore * 0.55);
    const selectedResults: RelevantChunkResult[] = [];
    const selectionsByDocument = new Map<string, number>();
    const maxPerDocument = Math.max(2, Math.ceil(limit / 2));

    for (const candidate of dedupedCandidates) {
      if (selectedResults.length >= limit) {
        break;
      }

      const documentKey = String(candidate.documentId);
      const currentDocumentCount = selectionsByDocument.get(documentKey) ?? 0;

      if (
        currentDocumentCount >= maxPerDocument &&
        candidate.score < topScore * 0.92
      ) {
        continue;
      }

      if (candidate.score >= dynamicThreshold || selectedResults.length < 2) {
        selectedResults.push(candidate);
        selectionsByDocument.set(documentKey, currentDocumentCount + 1);
      }
    }

    if (selectedResults.length === 0) {
      return dedupedCandidates.slice(0, limit);
    }

    return selectedResults.slice(0, limit);
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
      pageStart: v.optional(v.number()),
      pageEnd: v.optional(v.number()),
      section: v.optional(v.string()),
      chunkType: v.optional(chunkTypeValidator()),
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
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        chunkType: chunk.chunkType as ChunkType | undefined,
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
        metadata: v.object({
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
          section: v.optional(v.string()),
          chunkType: chunkTypeValidator(),
        }),
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
        ...(chunk.metadata.pageStart !== undefined
          ? { pageStart: chunk.metadata.pageStart }
          : {}),
        ...(chunk.metadata.pageEnd !== undefined
          ? { pageEnd: chunk.metadata.pageEnd }
          : {}),
        ...(chunk.metadata.section ? { section: chunk.metadata.section } : {}),
        chunkType: chunk.metadata.chunkType,
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
