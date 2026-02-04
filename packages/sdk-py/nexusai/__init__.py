"""NexusAI Python SDK.

Example:
    from nexusai import NexusClient
    nx = NexusClient(api_key="nxs_...")
    agent = nx.agents.create(
        name="Researcher",
        goal="Help research topics",
        persona={"name": "Researcher", "systemPrompt": "You are a careful researcher."},
    )
    async for step in nx.agents.run(agent["id"], "Summarize today's AI news"):
        print(step["kind"], step["content"])
"""
from .client import NexusClient

__all__ = ["NexusClient"]
