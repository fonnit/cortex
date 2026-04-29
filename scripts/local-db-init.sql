-- pgvector extension for halfvec(512) embeddings — Prisma 7 should also
-- create this via `db push` because the schema declares postgresqlExtensions,
-- but doing it on first DB init makes the whole flow idempotent.
CREATE EXTENSION IF NOT EXISTS vector;
