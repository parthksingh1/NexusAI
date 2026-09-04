"""Prometheus collectors for the manager service.

Kept in one module so the router, workers, tools and API all record against the same
registry without importing each other.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

llm_latency_ms = Histogram(
    "nexus_manager_llm_latency_ms",
    "LLM call latency",
    ["provider", "model"],
    buckets=(50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000),
)

llm_tokens_total = Counter(
    "nexus_manager_llm_tokens_total",
    "Tokens consumed by LLM calls",
    ["provider", "model", "kind"],
)

llm_calls_total = Counter(
    "nexus_manager_llm_calls_total",
    "LLM calls by outcome",
    ["provider", "model", "outcome"],
)

llm_cost_usd_total = Counter(
    "nexus_manager_llm_cost_usd_total",
    "Cumulative LLM spend in USD",
    ["provider", "model"],
)

tool_latency_ms = Histogram(
    "nexus_manager_tool_latency_ms",
    "Tool call latency",
    ["tool"],
    buckets=(25, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 30000, 60000),
)

tool_calls_total = Counter(
    "nexus_manager_tool_calls_total",
    "Tool calls by outcome",
    ["tool", "outcome"],
)

runs_total = Counter(
    "nexus_manager_runs_total",
    "Runs by terminal status",
    ["status"],
)

run_duration_ms = Histogram(
    "nexus_manager_run_duration_ms",
    "End-to-end run wall time",
    buckets=(1000, 5000, 15000, 30000, 60000, 120000, 180000, 300000),
)

workers_total = Counter(
    "nexus_manager_workers_total",
    "Worker executions by type and outcome",
    ["worker", "outcome"],
)

active_runs = Gauge(
    "nexus_manager_active_runs",
    "Runs currently executing",
)

budget_exceeded_total = Counter(
    "nexus_manager_budget_exceeded_total",
    "Runs halted by a budget cap",
    ["cap"],
)
