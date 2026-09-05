"""Worker registry.

Workers are leaves: a worker may call tools, never another worker. Only the manager creates
work, which is what keeps the agent count bounded and the graph acyclic.
"""

from nexus_agents_shared import TaskType

from .base import BaseWorker, EmitFn, WorkerContext
from .coder import CoderWorker
from .researcher import ResearcherWorker
from .synthesizer import SynthesizerWorker
from .video_analyst import VideoAnalystWorker
from .web_scraper import WebScraperWorker

WORKERS: dict[TaskType, type[BaseWorker]] = {
    TaskType.RESEARCH: ResearcherWorker,
    TaskType.SCRAPE: WebScraperWorker,
    TaskType.VIDEO: VideoAnalystWorker,
    TaskType.CODE: CoderWorker,
    TaskType.SYNTHESIZE: SynthesizerWorker,
}


def worker_for(task_type: TaskType) -> BaseWorker:
    """Instantiate the worker that handles this task type."""
    try:
        return WORKERS[task_type]()
    except KeyError:
        raise ValueError(f"no worker handles task type {task_type!r}") from None


__all__ = [
    "BaseWorker",
    "CoderWorker",
    "EmitFn",
    "ResearcherWorker",
    "SynthesizerWorker",
    "VideoAnalystWorker",
    "WORKERS",
    "WebScraperWorker",
    "WorkerContext",
    "worker_for",
]
