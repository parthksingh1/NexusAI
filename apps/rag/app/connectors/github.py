from __future__ import annotations

import os

import httpx


async def fetch_github_repo_readme(owner: str, repo: str) -> tuple[str, str, str]:
    """Return (title, url, readme_markdown) for a public repo. GITHUB_TOKEN optional."""
    token = os.getenv("GITHUB_TOKEN")
    headers = {"accept": "application/vnd.github.v3.raw", "user-agent": "NexusAI"}
    if token:
        headers["authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.get(f"https://api.github.com/repos/{owner}/{repo}/readme", headers=headers)
        r.raise_for_status()
        return (
            f"{owner}/{repo} README",
            f"https://github.com/{owner}/{repo}",
            r.text,
        )


async def fetch_github_issue(owner: str, repo: str, issue_number: int) -> tuple[str, str, str]:
    token = os.getenv("GITHUB_TOKEN")
    headers = {"accept": "application/vnd.github+json", "user-agent": "NexusAI"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.get(f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}", headers=headers)
        r.raise_for_status()
        issue = r.json()
    body = f"# {issue['title']}\n\n{issue.get('body') or ''}"
    return (issue["title"], issue["html_url"], body)
