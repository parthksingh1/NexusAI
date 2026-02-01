# Kubernetes (GKE) manifests

Placeholder for Phase 6. Each service will ship:

- `Deployment` with HPA (target CPU + custom `nexus_active_runs` metric)
- `Service` (ClusterIP) + `Ingress` via GKE Gateway API
- `ConfigMap` for non-secret env
- `ExternalSecret` pulling from Google Secret Manager
- `PodDisruptionBudget` for zero-downtime rollouts

Data stores (Postgres, Redis, Kafka, Neo4j, ClickHouse) will run via their respective operators or
Cloud SQL / MemoryStore / Confluent Cloud / AuraDB / ClickHouse Cloud depending on tier.
