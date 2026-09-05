"""Budget enforcement.

The caps are enforced here, in code, not by asking a model to stay within them. A tracker
instance belongs to one run and is shared by every worker in it, so the limits are per run
rather than per worker.
"""

from __future__ import annotations

import threading

import structlog
from nexus_agents_shared import BudgetSnapshot

from ..config import Settings, settings as default_settings
from ..observability import metrics

log = structlog.get_logger(__name__)

# Fraction of a cap at which a warning is emitted so the UI can show pressure building.
WARN_AT = 0.8


class BudgetExceeded(RuntimeError):
    """A hard cap was reached. Carries which cap, so the run can report a real reason."""

    def __init__(self, message: str, cap: str = "tokens") -> None:
        super().__init__(message)
        self.cap = cap


class BudgetTracker:
    def __init__(
        self,
        max_tokens: int | None = None,
        max_usd: float | None = None,
        max_agents: int | None = None,
        max_depth: int | None = None,
        *,
        settings: Settings | None = None,
    ) -> None:
        cfg = settings or default_settings
        self.max_tokens = max_tokens if max_tokens is not None else cfg.max_total_tokens
        self.max_usd = max_usd if max_usd is not None else cfg.max_usd
        self.max_agents = max_agents if max_agents is not None else cfg.max_agents_spawned
        self.max_depth = max_depth if max_depth is not None else cfg.max_depth

        self.tokens_used = 0
        self.usd_spent = 0.0
        self.agents_spawned = 0
        self.depth = 0
        self._lock = threading.Lock()
        self._warned: set[str] = set()

    # ─── Registration ───────────────────────────────────────────

    def register_spawn(self, depth: int = 1) -> None:
        """Account for one worker about to run."""
        with self._lock:
            if self.agents_spawned + 1 > self.max_agents:
                metrics.budget_exceeded_total.labels("agents").inc()
                raise BudgetExceeded(
                    f"agent cap reached: {self.agents_spawned} of {self.max_agents} already spawned", cap="agents"
                )
            if depth > self.max_depth:
                metrics.budget_exceeded_total.labels("depth").inc()
                raise BudgetExceeded(f"depth {depth} exceeds the maximum of {self.max_depth}", cap="depth")
            self.agents_spawned += 1
            self.depth = max(self.depth, depth)

    def register_llm_call(self, tokens: int, cost_usd: float) -> None:
        """Account for one completed LLM call, then enforce the caps.

        Registration happens before the check so spend that already occurred is always
        recorded — a call that pushes the run over the limit still cost money.
        """
        with self._lock:
            self.tokens_used += max(0, tokens)
            self.usd_spent += max(0.0, cost_usd)
            over_tokens = self.tokens_used >= self.max_tokens
            over_usd = self.usd_spent >= self.max_usd

        if over_tokens:
            metrics.budget_exceeded_total.labels("tokens").inc()
            raise BudgetExceeded(
                f"token cap reached: {self.tokens_used} of {self.max_tokens}", cap="tokens"
            )
        if over_usd:
            metrics.budget_exceeded_total.labels("usd").inc()
            raise BudgetExceeded(
                f"cost cap reached: ${self.usd_spent:.4f} of ${self.max_usd:.2f}", cap="usd"
            )

    # ─── Non-raising checks ─────────────────────────────────────

    def can_spend(self, estimated_tokens: int) -> bool:
        """Whether a call of roughly this size can still be afforded."""
        with self._lock:
            return (
                self.tokens_used + max(0, estimated_tokens) < self.max_tokens
                and self.usd_spent < self.max_usd
                and self.agents_spawned <= self.max_agents
            )

    def can_spawn(self) -> bool:
        with self._lock:
            return self.agents_spawned < self.max_agents

    @property
    def exhausted(self) -> bool:
        with self._lock:
            return (
                self.tokens_used >= self.max_tokens
                or self.usd_spent >= self.max_usd
                or self.agents_spawned >= self.max_agents
            )

    def pressure(self) -> str | None:
        """Name a cap that has crossed the warning threshold, once per cap."""
        with self._lock:
            checks = {
                "tokens": self.tokens_used / self.max_tokens if self.max_tokens else 0.0,
                "usd": self.usd_spent / self.max_usd if self.max_usd else 0.0,
                "agents": self.agents_spawned / self.max_agents if self.max_agents else 0.0,
            }
            for cap, ratio in checks.items():
                if ratio >= WARN_AT and cap not in self._warned:
                    self._warned.add(cap)
                    return cap
        return None

    def snapshot(self) -> BudgetSnapshot:
        with self._lock:
            return BudgetSnapshot(
                tokens_used=self.tokens_used,
                max_tokens=self.max_tokens,
                usd_spent=round(self.usd_spent, 6),
                max_usd=self.max_usd,
                agents_spawned=self.agents_spawned,
                max_agents=self.max_agents,
                depth=self.depth,
                max_depth=self.max_depth,
            )
