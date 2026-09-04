from __future__ import annotations

import asyncio
import json
from typing import Any

from ..config import settings
from ..schemas import Assertion, ScoreDetail

# The Gemini SDK is imported lazily: deterministic assertions must stay runnable
# (in CI, for instance) without the LLM provider SDKs installed.
_genai: Any = None

_SYSTEM = (
    "You are a strict evaluator of AI agent outputs. You are given a task, the agent's output, "
    "an optional reference answer, and a rubric. Grade how well the output satisfies the rubric.\n"
    "Be harsh: an output that is plausible but does not actually satisfy the rubric scores below 0.5. "
    "Ignore style unless the rubric asks about style.\n"
    'Reply strictly as JSON: {"score": <float 0..1>, "reason": "<one sentence>"}'
)


def _ensure_configured() -> Any:
    global _genai
    if _genai is None:
        import google.generativeai as genai

        genai.configure(api_key=settings.google_api_key)
        _genai = genai
    return _genai


def _fail(a: Assertion, detail: str) -> ScoreDetail:
    return ScoreDetail(type=a.type, passed=False, score=0.0, weight=a.weight, required=a.required, detail=detail)


async def score_llm_judge(a: Assertion, task: str, output: str, expected: str | None) -> ScoreDetail:
    rubric = str(a.value or a.options.get("rubric") or "").strip()
    if not rubric:
        return _fail(a, "no rubric supplied")
    if not settings.google_api_key:
        return _fail(a, "GOOGLE_API_KEY not set — llm_judge unavailable")

    threshold = float(a.options.get("threshold", 0.7))
    try:
        genai = _ensure_configured()
    except ImportError:
        return _fail(a, "google-generativeai is not installed — llm_judge unavailable")

    prompt = (
        f"TASK:\n{task[:4000]}\n\n"
        f"RUBRIC:\n{rubric[:2000]}\n\n"
        + (f"REFERENCE ANSWER:\n{str(expected)[:4000]}\n\n" if expected else "")
        + f"AGENT OUTPUT:\n{output[:8000]}"
    )

    def _call() -> str:
        model = genai.GenerativeModel(
            settings.judge_model,
            system_instruction=_SYSTEM,
            generation_config={
                "temperature": 0.0,
                "max_output_tokens": 300,
                "response_mime_type": "application/json",
            },
        )
        resp = model.generate_content(prompt)
        return resp.text or "{}"

    try:
        raw = await asyncio.to_thread(_call)
        data = json.loads(raw)
    except (json.JSONDecodeError, OSError, ValueError) as exc:
        return _fail(a, f"judge call failed: {exc}")
    except Exception as exc:  # SDK raises provider-specific errors we don't want to import
        return _fail(a, f"judge call failed: {exc}")

    try:
        score = float(data.get("score", 0.0))
    except (TypeError, ValueError):
        return _fail(a, "judge returned a non-numeric score")
    score = max(0.0, min(1.0, score))
    reason = str(data.get("reason", ""))[:500]
    return ScoreDetail(
        type=a.type, passed=score >= threshold, score=score, weight=a.weight, required=a.required,
        detail=f"judge {score:.2f} (>= {threshold:.2f}): {reason}",
    )
