from __future__ import annotations

import json
import re
from typing import Any

from ..schemas import Assertion, ScoreDetail


def _detail(a: Assertion, passed: bool, score: float, detail: str) -> ScoreDetail:
    return ScoreDetail(
        type=a.type, passed=passed, score=max(0.0, min(1.0, score)), weight=a.weight, required=a.required, detail=detail
    )


def _norm(s: str, case_sensitive: bool) -> str:
    s = s.strip()
    return s if case_sensitive else s.lower()


def score_exact(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    target = a.value if a.value is not None else expected
    if target is None:
        return _detail(a, False, 0.0, "no expected value supplied")
    cs = bool(a.options.get("caseSensitive", False))
    ok = _norm(output, cs) == _norm(str(target), cs)
    return _detail(a, ok, 1.0 if ok else 0.0, "exact match" if ok else f"expected {str(target)!r}")


def score_contains(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    needles = a.value if isinstance(a.value, list) else [a.value if a.value is not None else expected]
    needles = [str(n) for n in needles if n is not None]
    if not needles:
        return _detail(a, False, 0.0, "no substring supplied")
    cs = bool(a.options.get("caseSensitive", False))
    hay = _norm(output, cs)
    hits = [n for n in needles if _norm(n, cs) in hay]
    # Partial credit: a multi-substring assertion scores by fraction found, but only
    # passes when every substring is present.
    score = len(hits) / len(needles)
    ok = len(hits) == len(needles)
    missing = [n for n in needles if n not in hits]
    return _detail(a, ok, score, "all substrings present" if ok else f"missing: {missing}")


def score_not_contains(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    needles = a.value if isinstance(a.value, list) else [a.value]
    needles = [str(n) for n in needles if n is not None]
    if not needles:
        return _detail(a, False, 0.0, "no substring supplied")
    cs = bool(a.options.get("caseSensitive", False))
    hay = _norm(output, cs)
    found = [n for n in needles if _norm(n, cs) in hay]
    ok = not found
    return _detail(a, ok, 1.0 if ok else 0.0, "clean" if ok else f"forbidden substrings present: {found}")


def score_regex(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    pattern = a.value if a.value is not None else expected
    if pattern is None:
        return _detail(a, False, 0.0, "no pattern supplied")
    flags = 0 if a.options.get("caseSensitive", False) else re.IGNORECASE
    if a.options.get("dotAll", False):
        flags |= re.DOTALL
    try:
        ok = re.search(str(pattern), output, flags) is not None
    except re.error as exc:
        return _detail(a, False, 0.0, f"invalid regex: {exc}")
    return _detail(a, ok, 1.0 if ok else 0.0, "matched" if ok else f"no match for {pattern!r}")


def _dig(data: Any, path: str) -> Any:
    """Walk a dotted path, supporting list indices: `choices.0.message.content`."""
    cur = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            if not part.lstrip("-").isdigit():
                raise KeyError(f"{part!r} is not a list index")
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            if part not in cur:
                raise KeyError(part)
            cur = cur[part]
        else:
            raise KeyError(part)
    return cur


def score_json_path(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    path = str(a.options.get("path", ""))
    try:
        parsed = json.loads(output)
    except (json.JSONDecodeError, TypeError):
        return _detail(a, False, 0.0, "output is not valid JSON")
    if not path:
        # No path means "output must be valid JSON", which it now is.
        return _detail(a, True, 1.0, "valid JSON")
    try:
        actual = _dig(parsed, path)
    except (KeyError, IndexError, TypeError) as exc:
        return _detail(a, False, 0.0, f"path {path!r} not found ({exc})")
    if a.value is None:
        return _detail(a, True, 1.0, f"path {path!r} present")
    ok = actual == a.value
    return _detail(a, ok, 1.0 if ok else 0.0, "matched" if ok else f"{path}={actual!r}, expected {a.value!r}")


def score_numeric(a: Assertion, output: str, expected: str | None) -> ScoreDetail:
    target = a.value if a.value is not None else expected
    if target is None:
        return _detail(a, False, 0.0, "no expected number supplied")
    try:
        want = float(target)
    except (TypeError, ValueError):
        return _detail(a, False, 0.0, f"expected value {target!r} is not numeric")
    # Pull the first number out of the output — models pad answers with prose.
    match = re.search(r"-?\d+(?:[\d,]*\d)?(?:\.\d+)?", output.replace(",", ""))
    if not match:
        return _detail(a, False, 0.0, "no number found in output")
    got = float(match.group(0))
    tolerance = float(a.options.get("tolerance", 0.0))
    ok = abs(got - want) <= tolerance
    return _detail(a, ok, 1.0 if ok else 0.0, f"got {got}, want {want} (±{tolerance})")


def score_latency_budget(a: Assertion, latency_ms: int) -> ScoreDetail:
    budget = float(a.options.get("maxMs", a.value or 0) or 0)
    if budget <= 0:
        return _detail(a, False, 0.0, "no latency budget supplied")
    ok = latency_ms <= budget
    # Degrade linearly to zero at 2x the budget so near-misses are distinguishable
    # from blowouts in the aggregate score.
    score = 1.0 if ok else max(0.0, 2.0 - latency_ms / budget)
    return _detail(a, ok, score, f"{latency_ms}ms vs {budget:.0f}ms budget")


def score_cost_budget(a: Assertion, cost_usd: float) -> ScoreDetail:
    budget = float(a.options.get("maxUsd", a.value or 0) or 0)
    if budget <= 0:
        return _detail(a, False, 0.0, "no cost budget supplied")
    ok = cost_usd <= budget
    score = 1.0 if ok else max(0.0, 2.0 - cost_usd / budget)
    return _detail(a, ok, score, f"${cost_usd:.6f} vs ${budget:.6f} budget")
