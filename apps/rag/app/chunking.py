from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

import tiktoken

Strategy = Literal["fixed", "recursive", "semantic", "markdown"]

_ENC = tiktoken.get_encoding("cl100k_base")


@dataclass(slots=True)
class Chunk:
    text: str
    position: int
    token_count: int


def _tokens(text: str) -> int:
    return len(_ENC.encode(text))


def chunk_fixed(text: str, size: int = 512, overlap: int = 64) -> list[Chunk]:
    tokens = _ENC.encode(text)
    out: list[Chunk] = []
    pos = 0
    step = max(1, size - overlap)
    while pos < len(tokens):
        window = tokens[pos : pos + size]
        out.append(Chunk(text=_ENC.decode(window), position=len(out), token_count=len(window)))
        pos += step
    return out


_SPLITTERS = ["\n\n", "\n", ". ", "? ", "! ", " "]


def chunk_recursive(text: str, max_tokens: int = 512) -> list[Chunk]:
    """LangChain-style recursive splitter: try increasingly finer separators."""

    def _split(s: str, sep_idx: int) -> list[str]:
        if _tokens(s) <= max_tokens:
            return [s]
        if sep_idx >= len(_SPLITTERS):
            return chunk_fixed(s, size=max_tokens, overlap=0)[0:].__iter__() and [c.text for c in chunk_fixed(s, max_tokens, 0)]
        sep = _SPLITTERS[sep_idx]
        parts = s.split(sep)
        out: list[str] = []
        buf = ""
        for p in parts:
            candidate = (buf + sep + p) if buf else p
            if _tokens(candidate) <= max_tokens:
                buf = candidate
            else:
                if buf:
                    out.extend(_split(buf, sep_idx + 1))
                buf = p
        if buf:
            out.extend(_split(buf, sep_idx + 1))
        return out

    pieces = _split(text, 0)
    return [Chunk(text=p.strip(), position=i, token_count=_tokens(p)) for i, p in enumerate(pieces) if p.strip()]


_MD_HEADING = re.compile(r"^(#{1,6})\s+.+$", re.MULTILINE)


def chunk_markdown(text: str, max_tokens: int = 512) -> list[Chunk]:
    """Split on markdown headings, then recurse any oversized sections."""
    offsets = [m.start() for m in _MD_HEADING.finditer(text)]
    if not offsets:
        return chunk_recursive(text, max_tokens)
    offsets.append(len(text))
    sections = [text[a:b].strip() for a, b in zip(offsets, offsets[1:]) if text[a:b].strip()]
    out: list[Chunk] = []
    for section in sections:
        if _tokens(section) <= max_tokens:
            out.append(Chunk(text=section, position=len(out), token_count=_tokens(section)))
        else:
            for sub in chunk_recursive(section, max_tokens):
                out.append(Chunk(text=sub.text, position=len(out), token_count=sub.token_count))
    return out


def chunk_text(text: str, strategy: Strategy = "recursive", max_tokens: int = 512) -> list[Chunk]:
    if strategy == "fixed":
        return chunk_fixed(text, max_tokens)
    if strategy == "markdown":
        return chunk_markdown(text, max_tokens)
    # "semantic" upgrades to embedding-boundary chunking in Phase 2 — fall back for now
    return chunk_recursive(text, max_tokens)
