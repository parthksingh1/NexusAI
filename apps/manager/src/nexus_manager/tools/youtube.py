"""Read public YouTube transcripts and metadata.

Transcripts come from youtube-transcript-api and metadata from yt-dlp with downloading
disabled. Private, age-gated and transcript-less videos fail with a plain reason; nothing
here attempts to work around an age gate or a login.
"""

from __future__ import annotations

import asyncio
import re
from urllib.parse import parse_qs, urlparse

import structlog

from ..config import Settings
from ..config import settings as default_settings
from .schemas import Segment, UrlInput, Video, VideoResult

log = structlog.get_logger(__name__)

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

PREFERRED_LANGUAGES = ["en", "en-US", "en-GB"]


def extract_video_id(url: str) -> str | None:
    """Pull the 11-character video id out of any of YouTube's URL shapes."""
    if _ID_RE.match(url):
        return url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
        return candidate if _ID_RE.match(candidate) else None
    if host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
            return candidate if _ID_RE.match(candidate) else None
        for prefix in ("/embed/", "/v/", "/shorts/", "/live/"):
            if parsed.path.startswith(prefix):
                candidate = parsed.path[len(prefix) :].split("/")[0]
                return candidate if _ID_RE.match(candidate) else None
    return None


def _fetch_transcript_sync(video_id: str) -> list[Segment]:
    from youtube_transcript_api import YouTubeTranscriptApi

    api = YouTubeTranscriptApi()
    # Newer releases expose fetch(); older ones only get_transcript(). Support both so a
    # transitive upgrade does not break the tool.
    if hasattr(api, "fetch"):
        fetched = api.fetch(video_id, languages=PREFERRED_LANGUAGES)
        raw = fetched.to_raw_data() if hasattr(fetched, "to_raw_data") else list(fetched)
    else:
        raw = YouTubeTranscriptApi.get_transcript(video_id, languages=PREFERRED_LANGUAGES)

    return [
        Segment(
            start_s=float(entry.get("start", 0.0)),
            duration_s=float(entry.get("duration", 0.0)),
            text=str(entry.get("text", "")).strip(),
        )
        for entry in raw
        if str(entry.get("text", "")).strip()
    ]


def _fetch_metadata_sync(video_id: str) -> dict:
    import yt_dlp

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return {
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration_s": int(info.get("duration") or 0),
    }


async def youtube_transcript(video_url: str, *, settings: Settings | None = None) -> VideoResult:
    """Fetch a public video transcript plus its title, channel and duration."""
    cfg = settings or default_settings

    if not video_url.startswith("http") and _ID_RE.match(video_url):
        video_url = f"https://www.youtube.com/watch?v={video_url}"
    try:
        UrlInput(url=video_url)
    except Exception as exc:
        return VideoResult(ok=False, error=f"invalid url: {exc}")

    video_id = extract_video_id(video_url)
    if not video_id:
        return VideoResult(ok=False, error=f"{video_url} is not a recognisable YouTube video URL")

    try:
        segments = await asyncio.wait_for(
            asyncio.to_thread(_fetch_transcript_sync, video_id), timeout=cfg.tool_timeout_s
        )
    except TimeoutError:
        return VideoResult(ok=False, error=f"transcript request for {video_id} timed out")
    except Exception as exc:
        name = type(exc).__name__
        if "Disabled" in name:
            reason = "transcripts are disabled for this video"
        elif "NotFound" in name or "NoTranscript" in name:
            reason = "no transcript is published for this video in a supported language"
        elif "Unavailable" in name or "Private" in name:
            reason = "the video is private or unavailable"
        elif "AgeRestricted" in name:
            reason = "the video is age-restricted and cannot be read without signing in"
        else:
            reason = str(exc)[:300]
        return VideoResult(ok=False, error=f"{video_id}: {reason}")

    if not segments:
        return VideoResult(ok=False, error=f"{video_id}: transcript was empty")

    meta: dict = {}
    try:
        meta = await asyncio.wait_for(
            asyncio.to_thread(_fetch_metadata_sync, video_id), timeout=cfg.tool_timeout_s
        )
    except Exception as exc:
        # Metadata is a nicety. A transcript without a title is still worth returning.
        log.warning("youtube_metadata_failed", video_id=video_id, error=str(exc)[:200])

    return VideoResult(
        video=Video(
            id=video_id,
            title=meta.get("title", ""),
            channel=meta.get("channel", ""),
            duration_s=int(meta.get("duration_s", 0) or int(segments[-1].start_s + segments[-1].duration_s)),
            url=f"https://www.youtube.com/watch?v={video_id}",
            transcript=segments,
        )
    )
