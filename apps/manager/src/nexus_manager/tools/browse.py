"""Render a page with a real browser.

Used when static extraction comes up short. Images, fonts and media are blocked, which cuts
page weight substantially and is the difference between a browser step being viable inside a
90-second worker timeout and not.
"""

from __future__ import annotations

import structlog

from ..config import Settings, settings as default_settings
from ..safety.guards import RateLimiter, RobotsCache, URLBlocked, check_url
from .fetch_url import extract_page
from .schemas import BrowseInput, PageResult

log = structlog.get_logger(__name__)

BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}


async def browse(
    url: str,
    wait_for: str | None = None,
    *,
    settings: Settings | None = None,
    robots: RobotsCache | None = None,
    limiter: RateLimiter | None = None,
) -> PageResult:
    """Load a URL in headless Chromium and extract the rendered content."""
    cfg = settings or default_settings
    try:
        inp = BrowseInput(url=url, wait_for=wait_for)
        target = str(inp.url)
    except Exception as exc:
        return PageResult(ok=False, error=f"invalid url: {exc}")

    try:
        check_url(target)
    except URLBlocked as exc:
        return PageResult(ok=False, error=str(exc))

    guard = robots or RobotsCache(cfg)
    if not await guard.allowed(target):
        return PageResult(ok=False, error=f"robots.txt disallows fetching {target}")

    await (limiter or RateLimiter(cfg)).acquire(target)

    try:
        from playwright.async_api import Error as PlaywrightError
        from playwright.async_api import async_playwright
    except ImportError:
        return PageResult(ok=False, error="playwright is not installed")

    timeout_ms = int(cfg.tool_timeout_s * 1000)
    try:
        async with async_playwright() as pw:
            try:
                browser = await pw.chromium.launch(headless=True)
            except PlaywrightError as exc:
                return PageResult(
                    ok=False,
                    error=f"chromium is not available to playwright ({exc}); run: playwright install chromium",
                )
            try:
                context = await browser.new_context(user_agent=cfg.user_agent)
                page = await context.new_page()

                async def _block(route):
                    if route.request.resource_type in BLOCKED_RESOURCE_TYPES:
                        await route.abort()
                    else:
                        await route.continue_()

                await page.route("**/*", _block)
                response = await page.goto(target, timeout=timeout_ms, wait_until="domcontentloaded")
                if response is not None and response.status in (401, 403):
                    return PageResult(
                        ok=False,
                        error=f"{target} requires authentication ({response.status}); not scraped",
                    )
                if inp.wait_for:
                    await page.wait_for_selector(inp.wait_for, timeout=timeout_ms)
                html = await page.content()
                final_url = page.url
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return PageResult(ok=False, error=f"browser error loading {target}: {exc}")
    except Exception as exc:
        return PageResult(ok=False, error=f"browser failed on {target}: {exc}")

    extracted = extract_page(html, final_url)
    extracted.fetched_with = "playwright"
    if not extracted.text.strip():
        return PageResult(ok=False, page=extracted, error=f"{target} rendered but produced no readable text")
    return PageResult(page=extracted)
