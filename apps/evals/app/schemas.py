from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AssertionType = Literal[
    "exact",
    "contains",
    "not_contains",
    "regex",
    "json_path",
    "numeric",
    "latency_budget",
    "cost_budget",
    "embedding_similarity",
    "llm_judge",
]


class Assertion(BaseModel):
    """One check applied to a case's output. `weight` scales its contribution to the case score;
    `required` assertions must pass for the case to pass (all assertions are required by default)."""

    type: AssertionType
    # Interpretation depends on `type`: the literal to match, the regex, the rubric, etc.
    value: Any = None
    # Free-form knobs: `path` (json_path), `tolerance` (numeric), `threshold` (similarity),
    # `caseSensitive` (exact/contains), `maxMs` (latency_budget), `maxUsd` (cost_budget).
    options: dict[str, Any] = Field(default_factory=dict)
    weight: float = Field(default=1.0, gt=0)
    required: bool = True


class ScoreDetail(BaseModel):
    # Deliberately a plain str, not AssertionType: this is an output record and must be able
    # to carry back an unrecognised assertion type rather than fail validation.
    type: str
    passed: bool
    score: float = Field(ge=0.0, le=1.0)
    weight: float
    required: bool
    detail: str = ""


# ─── Targets ────────────────────────────────────────────────────


class AgentTarget(BaseModel):
    type: Literal["agent"] = "agent"
    agentId: str
    maxSteps: int | None = None
    ownerId: str | None = None


class HttpTarget(BaseModel):
    type: Literal["http"] = "http"
    url: str
    method: Literal["POST", "GET"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    # Where the case input goes in the request body, and where the output is read from
    # in the JSON response (dotted path). Defaults suit a `{input} -> {output}` API.
    inputField: str = "input"
    outputPath: str = "output"


class EchoTarget(BaseModel):
    """Returns the case input verbatim. Useful for smoke-testing a suite's assertions
    without spending tokens."""

    type: Literal["echo"] = "echo"


Target = AgentTarget | HttpTarget | EchoTarget


# ─── Suites & cases ─────────────────────────────────────────────


class CaseInput(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    input: str = Field(min_length=1)
    expected: str | None = None
    assertions: list[Assertion] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    weight: float = Field(default=1.0, gt=0)


class SuiteCreate(BaseModel):
    ownerId: str
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    target: Target = Field(default_factory=EchoTarget, discriminator="type")
    cases: list[CaseInput] = Field(default_factory=list)


class CaseOut(CaseInput):
    id: str
    position: int


class SuiteOut(BaseModel):
    id: str
    ownerId: str
    name: str
    description: str | None
    target: dict[str, Any]
    cases: list[CaseOut]
    createdAt: str
    updatedAt: str


class SuiteSummary(BaseModel):
    id: str
    ownerId: str
    name: str
    description: str | None
    caseCount: int
    createdAt: str
    updatedAt: str


# ─── Runs ───────────────────────────────────────────────────────


class RunRequest(BaseModel):
    # Overrides the suite's stored target for this run — lets you evaluate the same
    # suite against a candidate agent and a baseline agent.
    target: Target | None = Field(default=None, discriminator="type")
    label: str | None = None
    baselineRunId: str | None = None
    concurrency: int | None = Field(default=None, ge=1, le=32)
    caseKeys: list[str] | None = None


class CaseResult(BaseModel):
    caseKey: str
    output: str | None
    passed: bool
    score: float
    latencyMs: int
    costUsd: float
    scores: list[ScoreDetail]
    error: str | None = None


class RunSummary(BaseModel):
    total: int
    passed: int
    failed: int
    errored: int
    passRate: float
    meanScore: float
    p50LatencyMs: int
    p95LatencyMs: int
    totalCostUsd: float
    byAssertion: dict[str, dict[str, float]]


class RunOut(BaseModel):
    id: str
    suiteId: str
    status: Literal["running", "completed", "failed"]
    label: str | None
    target: dict[str, Any]
    baselineRunId: str | None
    summary: RunSummary | None
    results: list[CaseResult]
    error: str | None
    startedAt: str
    finishedAt: str | None


class RunSummaryOut(BaseModel):
    id: str
    suiteId: str
    status: str
    label: str | None
    summary: RunSummary | None
    startedAt: str
    finishedAt: str | None


# ─── Regression comparison ──────────────────────────────────────


class CaseDelta(BaseModel):
    caseKey: str
    baselineScore: float | None
    candidateScore: float | None
    scoreDelta: float
    verdict: Literal["fixed", "regressed", "unchanged", "added", "removed"]


class CompareResult(BaseModel):
    baselineRunId: str
    candidateRunId: str
    passRateDelta: float
    meanScoreDelta: float
    costDelta: float
    p95LatencyDelta: int
    regressions: list[CaseDelta]
    fixes: list[CaseDelta]
    unchanged: int
    # True when the candidate is safe to ship under the supplied thresholds.
    gatePassed: bool
    gateReasons: list[str]
