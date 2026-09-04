"""Guards applied before any outbound web request.

Three independent checks, in order of cost: a URL denylist (free), robots.txt (one cached
fetch per host), and a per-domain rate limit (one Redis round trip). All three fail closed
for the denylist and open for the rest — an unreachable Redis must not stop the service, but
a request to a private address must always be refused.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
import structlog

from ..config import Settings, settings as default_settings

log = structlog.get_logger(__name__)

ALLOWED_SCHEMES = {"http", "https"}

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "metadata.google.internal",
}

# Cloud instance-metadata endpoints. Reaching these from a tool would leak credentials.
BLOCKED_LITERAL_IPS = {"169.254.169.254", "100.100.100.200"}


class URLBlocked(ValueError):
    """The URL is not permitted. Raised rather than returned so no caller can ignore it."""


def _is_private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def check_url(url: str, *, resolve_dns: bool = True) -> str:
    """Validate a URL for outbound fetching. Returns the hostname, or raises URLBlocked.

    DNS is resolved so that a public-looking name pointing at 127.0.0.1 or an internal
    address is caught too, not just literal private IPs.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise URLBlocked(f"scheme {parsed.scheme or '(none)'!r} is not permitted; use http or https")

    host = (parsed.hostname or "").lower()
    if not host:
        raise URLBlocked("URL has no host")
    if host in BLOCKED_HOSTNAMES or host.endswith(".localhost"):
        raise URLBlocked(f"host {host!r} is not permitted")
    if host in BLOCKED_LITERAL_IPS:
        raise URLBlocked(f"host {host!r} is an instance-metadata endpoint")
    if _is_private(host):
        raise URLBlocked(f"host {host!r} is a private or loopback address")

    if resolve_dns:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            # Name does not resolve. Let the HTTP client produce the error with its own
            # message rather than guessing here.
            return host
        for info in infos:
            addr = info[4][0]
            if addr in BLOCKED_LITERAL_IPS or _is_private(addr):
                raise URLBlocked(f"host {host!r} resolves to a private address ({addr})")
    return host


def domain_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


class RobotsCache:
    """robots.txt lookups, cached in Redis when available and in-process otherwise.

    A host whose robots.txt cannot be fetched is treated as permitting the request, which is
    the conventional reading: absence of a policy is not a prohibition.
    """

    def __init__(self, settings: Settings | None = None, redis_client=None) -> None:
        self._settings = settings or default_settings
        self._redis = redis_client
        self._local: dict[str, tuple[float, str]] = {}

    def _key(self, host: str) -> str:
        return f"manager:robots:{host}"

    async def _load(self, url: str) -> str | None:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        base = f"{parsed.scheme}://{parsed.netloc}"
        ttl = self._settings.robots_cache_ttl_s

        if self._redis is not None:
            try:
                cached = await self._redis.get(self._key(host))
                if cached is not None:
                    return cached.decode() if isinstance(cached, bytes) else cached
            except Exception:
                pass

        hit = self._local.get(host)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]

        try:
            async with httpx.AsyncClient(
                timeout=10.0, follow_redirects=True, headers={"User-Agent": self._settings.user_agent}
            ) as client:
                resp = await client.get(f"{base}/robots.txt")
            body = resp.text if resp.status_code == 200 else ""
        except httpx.HTTPError:
            body = ""

        self._local[host] = (time.time(), body)
        if self._redis is not None:
            try:
                await self._redis.setex(self._key(host), ttl, body)
            except Exception:
                pass
        return body

    async def allowed(self, url: str) -> bool:
        body = await self._load(url)
        if not body:
            return True
        parser = RobotFileParser()
        parser.parse(body.splitlines())
        agent = self._settings.user_agent.split("/")[0]
        # Check both our token and the wildcard, so a site that names us specifically wins.
        return bool(parser.can_fetch(agent, url) and parser.can_fetch("*", url))


class RateLimiter:
    """One request per domain per interval.

    Uses Redis so the limit holds across worker tasks and across replicas of the service;
    falls back to an in-process clock when Redis is unavailable.
    """

    def __init__(self, settings: Settings | None = None, redis_client=None) -> None:
        self._settings = settings or default_settings
        self._redis = redis_client
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()

    @property
    def interval(self) -> float:
        return self._settings.per_domain_rate_limit_s

    async def acquire(self, url: str) -> None:
        """Block until this domain may be called again."""
        domain = domain_of(url)
        if not domain:
            return

        if self._redis is not None:
            try:
                await self._acquire_redis(domain)
                return
            except Exception:
                pass

        async with self._lock:
            now = time.monotonic()
            previous = self._last.get(domain)
            if previous is not None:
                wait = self.interval - (now - previous)
                if wait > 0:
                    await asyncio.sleep(wait)
            self._last[domain] = time.monotonic()

    async def _acquire_redis(self, domain: str) -> None:
        key = f"manager:ratelimit:{domain}"
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            ttl_ms = max(1, int(self.interval * 1000))
            acquired = await self._redis.set(key, "1", nx=True, px=ttl_ms)
            if acquired:
                return
            remaining = await self._redis.pttl(key)
            await asyncio.sleep(max(0.02, (remaining or ttl_ms) / 1000))
        raise TimeoutError(f"rate limit for {domain} did not clear within 30s")
