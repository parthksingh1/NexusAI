from __future__ import annotations

import uuid

from sqlalchemy import text

from .chunking import Strategy, chunk_text
from .db import get_session
from .embeddings import embed_batch


async def ingest_document(
    owner_id: str,
    source: str,
    source_id: str,
    title: str,
    url: str | None,
    body: str,
    strategy: Strategy = "recursive",
) -> dict:
    """Chunk → embed → upsert. Idempotent on (ownerId, source, sourceId)."""
    chunks = chunk_text(body, strategy=strategy)
    embeddings = await embed_batch([c.text for c in chunks])

    async with get_session() as s:
        doc_id = str(uuid.uuid4())
        await s.execute(
            text(
                """
                INSERT INTO rag."Document" (id, "ownerId", source, "sourceId", title, url, "createdAt", "updatedAt")
                VALUES (:id, :owner, :source::"rag"."DocumentSource", :sid, :title, :url, now(), now())
                ON CONFLICT ("ownerId", source, "sourceId")
                DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, "updatedAt" = now()
                RETURNING id
                """
            ),
            {
                "id": doc_id,
                "owner": owner_id,
                "source": source.upper(),
                "sid": source_id,
                "title": title,
                "url": url,
            },
        )
        # get final id (either inserted or existing)
        row = (
            await s.execute(
                text('SELECT id::text AS id FROM rag."Document" WHERE "ownerId"=:o AND source=:s::"rag"."DocumentSource" AND "sourceId"=:sid'),
                {"o": owner_id, "s": source.upper(), "sid": source_id},
            )
        ).mappings().first()
        final_id = row["id"] if row else doc_id

        # Replace existing chunks
        await s.execute(text('DELETE FROM rag."Chunk" WHERE "documentId"=:d'), {"d": final_id})

        for chunk, emb in zip(chunks, embeddings):
            vec_literal = "[" + ",".join(f"{x:.7f}" for x in emb) + "]"
            await s.execute(
                text(
                    """
                    INSERT INTO rag."Chunk" (id, "documentId", text, "tokenCount", position, embedding, tsv)
                    VALUES (:id, :doc, :txt, :tok, :pos, :emb::vector, to_tsvector('english', :txt))
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "doc": final_id,
                    "txt": chunk.text,
                    "tok": chunk.token_count,
                    "pos": chunk.position,
                    "emb": vec_literal,
                },
            )
        await s.commit()
    return {"documentId": final_id, "chunks": len(chunks)}
