"""Capture screenshots of the running web app for the README.

Real captures of the app as it renders — nothing composited or edited. Pages that talk to a
backend which is not running fall back to the app's own seeded fixtures, which is the
behaviour built into apps/web/lib/api.ts.

Start the web app first, then run this with the manager's virtualenv, which already has
Playwright and Chromium installed:

    pnpm --filter @nexusai/web dev
    apps/manager/.venv/Scripts/python scripts/capture_screenshots.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "screenshots"

BASE = os.getenv("WEB_URL", "http://127.0.0.1:3000")
VIEWPORT = {"width": 1512, "height": 945}

PAGES = [
    ("manager", "/manager"),
    ("dashboard", "/"),
    ("agents", "/agents"),
    ("metrics", "/metrics"),
    ("playground", "/playground"),
    ("knowledge", "/knowledge"),
    ("streams", "/streams"),
    ("memory-graph", "/memory-graph"),
    ("marketplace", "/marketplace"),
    ("traces", "/traces"),
]

# Seeds a session so pages render instead of bouncing to the login screen.
SESSION = """
localStorage.setItem('nexus_token', 'screenshot-session');
localStorage.setItem('nexus_user', JSON.stringify(%s));
"""


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    user = json.dumps(
        {"id": "u_1", "email": "parthksingh1@gmail.com", "name": "Parth Kumar Singh", "tier": "PRO"}
    )

    only = set(sys.argv[1:])
    targets = [(s, p) for s, p in PAGES if not only or s in only]

    captured: list[str] = []
    async with async_playwright() as pw:
        # A fresh browser per page. One page crashing the browser then loses only that page
        # rather than every page after it.
        for slug, path in targets:
            browser = None
            try:
                browser = await pw.chromium.launch()
                context = await browser.new_context(
                    viewport=VIEWPORT,
                    device_scale_factor=2,  # retina, so images stay sharp when scaled down
                    color_scheme="dark",
                )
                await context.add_init_script(SESSION % user)
                page = await context.new_page()
                await page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=60000)
                await page.wait_for_timeout(3000)  # entry animations and client-side fetches
                await page.screenshot(path=str(OUT_DIR / f"{slug}.png"))
                captured.append(slug)
                print(f"captured {path} -> docs/screenshots/{slug}.png")
            except Exception as exc:
                print(f"failed {path}: {str(exc)[:160]}")
            finally:
                if browser is not None:
                    await browser.close()

    print(f"\n{len(captured)}/{len(PAGES)} captured")
    return 0 if captured else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
