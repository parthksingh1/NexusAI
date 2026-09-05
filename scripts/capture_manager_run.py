"""Capture the manager page mid-run, with a live agent graph.

Drives the page the way a person does: type a goal, submit, wait for the planner to return,
then screenshot while the workers are still executing — nodes lit up is what the graph is
for. Nothing is injected or stubbed; the page runs its own request against the manager.

    apps/manager/.venv/Scripts/python scripts/capture_manager_run.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots" / "manager.png"

WEB = os.getenv("WEB_URL", "http://127.0.0.1:3000")
GOAL = os.getenv(
    "SCREENSHOT_GOAL",
    "Compare pgvector and Qdrant on indexing approach and query performance, with citations.",
)

# Local inference is slow; the planner call alone can take minutes on CPU.
PLAN_TIMEOUT_MS = int(os.getenv("PLAN_TIMEOUT_MS", "900000"))

SESSION = """
localStorage.setItem('nexus_token','screenshot-session');
localStorage.setItem('nexus_user', JSON.stringify(%s));
""" % json.dumps(
    {"id": "u_1", "email": "parthksingh1@gmail.com", "name": "Parth Kumar Singh", "tier": "PRO"}
)


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        context = await browser.new_context(
            viewport={"width": 1512, "height": 945}, device_scale_factor=2, color_scheme="dark"
        )
        await context.add_init_script(SESSION)
        page = await context.new_page()

        await page.goto(f"{WEB}/manager", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)

        await page.fill("input", GOAL)
        await page.press("input", "Enter")
        print("submitted; waiting for the planner")

        try:
            # The graph only mounts once a plan exists, so its appearance is the signal.
            await page.wait_for_selector(".react-flow__node", timeout=PLAN_TIMEOUT_MS)
        except Exception as exc:
            await page.screenshot(path=str(OUT))
            print(f"no graph appeared ({str(exc)[:120]}); captured the page as it stands")
            await browser.close()
            return 1

        nodes = await page.locator(".react-flow__node").count()
        print(f"graph rendered with {nodes} nodes; letting workers start")

        # Poll in short steps rather than one long wait. A single multi-minute wait keeps no
        # traffic on the driver connection and it gets dropped.
        running = 0
        for _ in range(60):
            await page.wait_for_timeout(10000)
            running = await page.evaluate(
                "() => Array.from(document.querySelectorAll('.react-flow__node'))"
                ".filter(n => n.innerText.includes('Running')).length"
            )
            done = await page.evaluate(
                "() => Array.from(document.querySelectorAll('.react-flow__node'))"
                ".filter(n => n.innerText.includes('Complete')).length"
            )
            print(f"  running={running} complete={done}", flush=True)
            if running or done:
                break
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(OUT))
        print(f"captured -> {OUT}")

        await browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
