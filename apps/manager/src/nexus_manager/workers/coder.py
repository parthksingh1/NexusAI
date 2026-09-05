"""Coder.

Writes code, runs it in the existing sandbox, and iterates on failure. `verified` is true
only when the sandbox actually exited zero — the model's opinion of its own code does not
set that flag.
"""

from __future__ import annotations

from nexus_agents_shared import Task, WorkerResult
from pydantic import BaseModel, Field

from .base import BaseWorker, WorkerContext

MAX_ATTEMPTS = 3
OUTPUT_EXCERPT_CHARS = 2000

SYSTEM = """You write a single self-contained program that solves the task and proves it works.

Rules:
- The program must print evidence that it is correct: assertions that pass, or a comparison
  against a known-good reference.
- Use only the standard library unless the task names a package.
- No network access, no file writing, no input() calls. The sandbox has no network.
- Return the complete program. Not a fragment, not a diff.
"""

REPAIR_SYSTEM = """You fix a program that failed when it was run.

You are given the program, its output, and its exit code. Return the complete corrected
program. Change only what is needed to make it run and pass its own checks.
"""


class CodeOutput(BaseModel):
    # Required: a defaulted field is skipped by a schema-constrained decoder.
    code: str
    language: str = Field(default="python")
    explanation: str = Field(default="")


class CoderWorker(BaseWorker):
    name = "coder"

    async def run(self, task: Task, ctx: WorkerContext) -> WorkerResult:
        language = str(task.inputs.get("lang") or task.inputs.get("language") or "python")
        tokens = 0
        cost = 0.0

        await self.step(ctx, task, "writing code", language=language)
        drafted, used, spent = await self.think_structured(
            ctx, SYSTEM, f"TASK: {task.goal}\n\nLanguage: {language}", CodeOutput, max_tokens=1600
        )
        tokens += used
        cost += spent

        code = drafted.code.strip()
        language = (drafted.language or language).strip() or "python"
        if not code:
            return WorkerResult(ok=False, error="the model returned no code", tokens_used=tokens, cost_usd=cost)

        last_stdout = ""
        last_stderr = ""
        exit_code = -1

        for attempt in range(1, MAX_ATTEMPTS + 1):
            await self.step(ctx, task, f"running in the sandbox (attempt {attempt})")
            execution = await ctx.tools.call("code_exec", lang=language, source=code)

            if not getattr(execution, "ok", False):
                reason = getattr(execution, "error", None) or getattr(execution, "message", "sandbox call failed")
                return WorkerResult(
                    ok=False,
                    output={"code": code, "language": language},
                    error=f"sandbox unavailable: {reason}",
                    tokens_used=tokens,
                    cost_usd=cost,
                )

            last_stdout = execution.stdout
            last_stderr = execution.stderr
            exit_code = execution.exit_code

            if exit_code == 0:
                await self.step(ctx, task, "code ran clean", attempt=attempt)
                return WorkerResult(
                    ok=True,
                    output={
                        "language": language,
                        "code": code,
                        "stdout": last_stdout[:OUTPUT_EXCERPT_CHARS],
                        "stderr": last_stderr[:OUTPUT_EXCERPT_CHARS],
                        "verified": True,
                        "attempts": attempt,
                        "explanation": drafted.explanation.strip(),
                    },
                    tokens_used=tokens,
                    cost_usd=cost,
                )

            if attempt == MAX_ATTEMPTS:
                break

            await self.step(ctx, task, f"exit code {exit_code}; repairing", stderr=last_stderr[:300])
            repair_input = (
                f"TASK: {task.goal}\n\nPROGRAM:\n{code}\n\n"
                f"EXIT CODE: {exit_code}\nSTDOUT:\n{last_stdout[:1500]}\nSTDERR:\n{last_stderr[:1500]}"
            )
            repaired, used, spent = await self.think_structured(
                ctx, REPAIR_SYSTEM, repair_input, CodeOutput, max_tokens=1600
            )
            tokens += used
            cost += spent
            if repaired.code.strip():
                code = repaired.code.strip()

        return WorkerResult(
            ok=False,
            output={
                "language": language,
                "code": code,
                "stdout": last_stdout[:OUTPUT_EXCERPT_CHARS],
                "stderr": last_stderr[:OUTPUT_EXCERPT_CHARS],
                "verified": False,
                "attempts": MAX_ATTEMPTS,
            },
            error=f"code still failed after {MAX_ATTEMPTS} attempts (exit code {exit_code})",
            tokens_used=tokens,
            cost_usd=cost,
        )
