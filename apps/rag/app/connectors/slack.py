from __future__ import annotations

import os

import httpx


async def fetch_slack_channel_history(channel_id: str, limit: int = 200) -> tuple[str, str, str]:
    """Return (title, url, body) for recent messages in a channel. Requires SLACK_BOT_TOKEN."""
    token = os.getenv("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN not set")
    async with httpx.AsyncClient(timeout=30.0, headers={"authorization": f"Bearer {token}"}) as c:
        resp = (await c.get(f"https://slack.com/api/conversations.history?channel={channel_id}&limit={limit}")).json()
        if not resp.get("ok"):
            raise RuntimeError(f"slack error: {resp.get('error')}")
        info = (await c.get(f"https://slack.com/api/conversations.info?channel={channel_id}")).json()

    name = info.get("channel", {}).get("name", channel_id) if info.get("ok") else channel_id
    messages = resp.get("messages", [])
    lines: list[str] = []
    for m in messages:
        ts = m.get("ts", "")
        user = m.get("user", "")
        text = (m.get("text") or "").replace("\n", " ")
        lines.append(f"[{ts}] <{user}>: {text}")
    body = "\n".join(reversed(lines))  # chronological
    return (f"#{name} ({len(messages)} msgs)", f"slack://channel/{channel_id}", body)
