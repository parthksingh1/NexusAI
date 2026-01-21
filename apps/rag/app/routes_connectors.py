from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .connectors.github import fetch_github_issue, fetch_github_repo_readme
from .connectors.notion import fetch_notion_page
from .connectors.slack import fetch_slack_channel_history
from .connectors.url_fetch import fetch_url
from .ingest import ingest_document

router = APIRouter(prefix="/connectors")


class UrlIngest(BaseModel):
    ownerId: str
    url: str


class GithubRepoIngest(BaseModel):
    ownerId: str
    owner: str
    repo: str


class GithubIssueIngest(BaseModel):
    ownerId: str
    owner: str
    repo: str
    issue: int


class NotionIngest(BaseModel):
    ownerId: str
    pageId: str


class SlackIngest(BaseModel):
    ownerId: str
    channelId: str
    limit: int = 200


@router.post("/url")
async def ingest_from_url(req: UrlIngest) -> dict:
    try:
        title, body = await fetch_url(req.url)
        return await ingest_document(req.ownerId, "url", req.url, title, req.url, body, "recursive")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/github/repo")
async def ingest_github_repo(req: GithubRepoIngest) -> dict:
    try:
        title, url, body = await fetch_github_repo_readme(req.owner, req.repo)
        return await ingest_document(req.ownerId, "github", f"{req.owner}/{req.repo}", title, url, body, "markdown")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/github/issue")
async def ingest_github_issue(req: GithubIssueIngest) -> dict:
    title, url, body = await fetch_github_issue(req.owner, req.repo, req.issue)
    sid = f"{req.owner}/{req.repo}#{req.issue}"
    return await ingest_document(req.ownerId, "github", sid, title, url, body, "markdown")


@router.post("/notion")
async def ingest_notion(req: NotionIngest) -> dict:
    title, url, body = await fetch_notion_page(req.pageId)
    return await ingest_document(req.ownerId, "notion", req.pageId, title, url, body, "markdown")


@router.post("/slack")
async def ingest_slack(req: SlackIngest) -> dict:
    title, url, body = await fetch_slack_channel_history(req.channelId, req.limit)
    return await ingest_document(req.ownerId, "slack", req.channelId, title, url, body, "recursive")
