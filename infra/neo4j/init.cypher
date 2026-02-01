// NexusAI Neo4j bootstrap — memory graph constraints + indexes

CREATE CONSTRAINT agent_id IF NOT EXISTS FOR (a:Agent) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT tool_id IF NOT EXISTS FOR (t:Tool) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE;

CREATE INDEX memory_agent IF NOT EXISTS FOR (m:Memory) ON (m.agentId);
CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.type);
CREATE INDEX memory_created IF NOT EXISTS FOR (m:Memory) ON (m.createdAt);
