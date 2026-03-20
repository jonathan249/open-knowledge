import { embed, embedMany } from "ai";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./embeddingConfig";

function assertEmbeddingDimensions(embedding: number[]) {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, received ${embedding.length}. Ensure Convex vector index dimensions and embedding model output dimensions match, then re-ingest sources if needed.`,
    );
  }
}

export async function embedSingleValue(value: string) {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value,
  });

  assertEmbeddingDimensions(embedding);
  return embedding;
}

export async function embedMultipleValues(
  values: string[],
  maxParallelCalls = 4,
) {
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values,
    maxParallelCalls,
  });

  for (const embedding of embeddings) {
    assertEmbeddingDimensions(embedding);
  }

  return embeddings;
}
