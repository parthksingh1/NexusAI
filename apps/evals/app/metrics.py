"""Prometheus collectors, in their own module so both the API and the runner can record
without importing each other."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

run_counter = Counter("nexus_evals_runs_total", "Eval runs by status (started/completed/failed)", ["status"])
case_counter = Counter("nexus_evals_cases_total", "Eval cases scored", ["outcome"])
run_latency = Histogram(
    "nexus_evals_run_latency_ms",
    "Eval run wall time",
    buckets=(500, 1000, 5000, 15000, 60000, 300000, 900000),
)
pass_rate_gauge = Gauge("nexus_evals_pass_rate", "Pass rate of the last completed run", ["suite"])
