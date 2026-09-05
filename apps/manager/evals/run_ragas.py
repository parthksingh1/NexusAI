"""Score researcher and synthesizer output with Ragas.

Runs each goal in the dataset through the manager, then measures three things about the
answer that came back:

  faithfulness       is every claim supported by the retrieved sources, or did the model
                     add something the material does not say
  answer_relevancy   does the answer address the question that was asked
  context_precision  did the retrieval surface material that mattered, or mostly noise

Writes evals/RESULTS.md and exits non-zero when a metric has regressed by more than the
allowed margin against the previous run, which is what makes this usable as a gate.

Usage:
    python evals/run_ragas.py --provider ollama
    python evals/run_ragas.py --provider gemini --max-regression 0.05
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
from datetime import UTC, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nexus_manager.api.runs import RunService  # noqa: E402
from nexus_manager.config import Settings  # noqa: E402
from nexus_manager.graph.streaming import EventBus  # noqa: E402

EVALS_DIR = Path(__file__).resolve().parent
DATASET = EVALS_DIR / "datasets" / "research_tasks.jsonl"
RESULTS_MD = EVALS_DIR / "RESULTS.md"
HISTORY = EVALS_DIR / "history.json"

METRICS = ("faithfulness", "answer_relevancy", "context_precision")
FAITHFULNESS_FLOOR = 0.75


def load_dataset() -> list[dict]:
    with DATASET.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


async def execute(settings: Settings, goal: str, provider: str) -> dict:
    """Run one goal and return the answer plus the contexts it was built from."""
    service = RunService(settings=settings, bus=EventBus(settings))
    record = await service.start(goal, provider)  # type: ignore[arg-type]
    if record.status == "error":
        return {"answer": "", "contexts": [], "status": "error", "reason": record.reason}

    task = service.store._tasks.get(record.run_id)
    if task is not None:
        await task

    final = service.store.get(record.run_id)
    if final is None:
        return {"answer": "", "contexts": [], "status": "error", "reason": "run vanished"}

    # Contexts are what the workers actually gathered — the material the answer must be
    # faithful to. Citations alone are not contexts; the claims are.
    contexts: list[str] = []
    for result in final.results.values():
        if not result.ok:
            continue
        output = result.output or {}
        if summary := output.get("summary"):
            contexts.append(str(summary))
        for finding in output.get("findings", []):
            if isinstance(finding, dict) and finding.get("claim"):
                contexts.append(f"{finding['claim']} (source: {finding.get('source', '')})")
        for page in output.get("pages", []):
            if isinstance(page, dict) and page.get("text"):
                contexts.append(str(page["text"])[:2000])

    return {
        "answer": final.answer or "",
        "contexts": [c for c in contexts if c.strip()],
        "status": final.status,
        "citations": final.citations,
        "cost_usd": final.budget.usd_spent if final.budget else 0.0,
    }


def score_with_ragas(rows: list[dict], provider: str) -> dict[str, float]:
    """Score with Ragas. Raises if Ragas or its judge model is unavailable."""
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import answer_relevancy, context_precision, faithfulness

    usable = [r for r in rows if r["answer"] and r["contexts"]]
    if not usable:
        raise RuntimeError("no run produced both an answer and contexts to score")

    dataset = Dataset.from_dict(
        {
            "question": [r["goal"] for r in usable],
            "answer": [r["answer"] for r in usable],
            "contexts": [r["contexts"] for r in usable],
            "ground_truth": [r["reference"] for r in usable],
        }
    )
    result = evaluate(dataset, metrics=[faithfulness, answer_relevancy, context_precision])
    scores = result.to_pandas()
    return {metric: float(scores[metric].mean()) for metric in METRICS if metric in scores}


def score_by_overlap(rows: list[dict]) -> dict[str, float]:
    """A lexical stand-in used when Ragas cannot run.

    This is a coarse proxy, not a substitute: it measures word overlap, not entailment. It
    is labelled as such in the report so a number from here is never mistaken for a
    model-graded score.
    """

    def words(text: str) -> set[str]:
        return {w for w in re.findall(r"[a-z]{4,}", text.lower())}

    faith: list[float] = []
    relevance: list[float] = []
    precision: list[float] = []

    for row in rows:
        answer = words(row["answer"])
        context = words(" ".join(row["contexts"]))
        question = words(row["goal"])
        reference = words(row["reference"])
        if not answer:
            faith.append(0.0)
            relevance.append(0.0)
            precision.append(0.0)
            continue
        faith.append(len(answer & context) / len(answer))
        relevance.append(len(answer & (question | reference)) / max(1, len(question | reference)))
        precision.append(len(context & reference) / max(1, len(reference)) if context else 0.0)

    return {
        "faithfulness": statistics.mean(faith) if faith else 0.0,
        "answer_relevancy": statistics.mean(relevance) if relevance else 0.0,
        "context_precision": statistics.mean(precision) if precision else 0.0,
    }


def load_history() -> list[dict]:
    if not HISTORY.exists():
        return []
    try:
        return json.loads(HISTORY.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def write_report(entry: dict, previous: dict | None, regressions: list[str]) -> None:
    lines = [
        "# Manager evaluation results",
        "",
        f"Run at {entry['timestamp']} against provider `{entry['provider']}` "
        f"(model `{entry['model']}`), scored by {entry['scorer']}.",
        "",
        f"{entry['scored']} of {entry['total']} goals produced a scorable answer.",
        "",
        "| Metric | Score | Previous | Delta |",
        "| --- | --- | --- | --- |",
    ]
    for metric in METRICS:
        score = entry["scores"].get(metric)
        if score is None:
            continue
        prior = (previous or {}).get("scores", {}).get(metric)
        delta = f"{score - prior:+.3f}" if prior is not None else "—"
        lines.append(f"| {metric} | {score:.3f} | {f'{prior:.3f}' if prior is not None else '—'} | {delta} |")

    lines += ["", f"Total spend: ${entry['cost_usd']:.4f}", f"Wall time: {entry['duration_s']:.0f}s", ""]

    if entry["scorer"] != "ragas":
        lines += [
            "> Scored by lexical overlap, not by Ragas. Overlap measures shared vocabulary, "
            "not entailment, so these numbers are a coarse proxy and are not comparable to "
            "Ragas scores.",
            "",
        ]

    if regressions:
        lines += ["## Regressions", ""] + [f"- {r}" for r in regressions] + [""]
    else:
        lines += ["No metric regressed beyond the allowed margin.", ""]

    lines += ["## Per-goal outcomes", "", "| Goal | Status | Citations |", "| --- | --- | --- |"]
    for row in entry["rows"]:
        lines.append(f"| {row['id']} | {row['status']} | {row['citations']} |")

    RESULTS_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def main() -> int:
    parser = argparse.ArgumentParser(description="Score manager output with Ragas")
    parser.add_argument("--provider", default=os.getenv("EVAL_PROVIDER", "ollama"))
    parser.add_argument("--max-regression", type=float, default=0.05)
    parser.add_argument("--worker-timeout", type=float, default=float(os.getenv("EVAL_WORKER_TIMEOUT_S", "600")))
    parser.add_argument("--limit", type=int, default=0, help="score only the first N goals")
    args = parser.parse_args()

    settings = Settings(
        DATABASE_URL=None,
        DEFAULT_LLM_PROVIDER=args.provider,
        WORKER_TIMEOUT_S=args.worker_timeout,
        TOOL_TIMEOUT_S=45.0,
    )

    goals = load_dataset()
    if args.limit:
        goals = goals[: args.limit]

    started = time.perf_counter()
    rows: list[dict] = []
    for index, item in enumerate(goals, start=1):
        print(f"[{index}/{len(goals)}] {item['id']}", flush=True)
        outcome = await execute(settings, item["goal"], args.provider)
        rows.append({**item, **outcome, "citations": len(outcome.get("citations", []))})
        print(f"    {outcome['status']} · {len(outcome['contexts'])} contexts", flush=True)

    try:
        scores = score_with_ragas(rows, args.provider)
        scorer = "ragas"
    except Exception as exc:
        print(f"Ragas unavailable ({str(exc)[:200]}); scoring by lexical overlap instead.", flush=True)
        scores = score_by_overlap(rows)
        scorer = "lexical-overlap"

    entry = {
        "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        "provider": args.provider,
        "model": settings.default_model_for(args.provider),  # type: ignore[arg-type]
        "scorer": scorer,
        "scores": scores,
        "total": len(rows),
        "scored": sum(1 for r in rows if r["answer"]),
        "cost_usd": sum(r.get("cost_usd", 0.0) for r in rows),
        "duration_s": time.perf_counter() - started,
        "rows": [{"id": r["id"], "status": r["status"], "citations": r["citations"]} for r in rows],
    }

    history = load_history()
    # Compare only against a run scored the same way; a Ragas score and an overlap score are
    # different measurements and a delta between them would be meaningless.
    previous = next((h for h in reversed(history) if h.get("scorer") == scorer), None)

    regressions: list[str] = []
    if previous:
        for metric, score in scores.items():
            prior = previous["scores"].get(metric)
            if prior is not None and score < prior - args.max_regression:
                regressions.append(
                    f"{metric} fell {prior - score:.3f} (from {prior:.3f} to {score:.3f}), "
                    f"limit {args.max_regression:.3f}"
                )

    if scorer == "ragas" and scores.get("faithfulness", 1.0) < FAITHFULNESS_FLOOR:
        regressions.append(
            f"faithfulness {scores['faithfulness']:.3f} is below the {FAITHFULNESS_FLOOR:.2f} floor"
        )

    history.append(entry)
    HISTORY.write_text(json.dumps(history, indent=2), encoding="utf-8")
    write_report(entry, previous, regressions)

    print()
    print(f"{'Metric':<20} {'Score':>8}")
    for metric in METRICS:
        if metric in scores:
            print(f"{metric:<20} {scores[metric]:>8.3f}")
    print()
    print(f"Report written to {RESULTS_MD}")

    if regressions:
        print("\nRegressions:")
        for regression in regressions:
            print(f"  {regression}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
