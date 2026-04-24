CREATE INDEX CONCURRENTLY IF NOT EXISTS item_embedding_hnsw
ON "Item" USING hnsw (embedding halfvec_ip_ops)
WITH (m = 16, ef_construction = 64);
