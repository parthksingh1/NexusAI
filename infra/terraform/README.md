# NexusAI Terraform (GCP)

Provisions production-grade GCP infrastructure:
- **GKE Autopilot** cluster (regional, auto-scaling, workload identity)
- **Cloud SQL** Postgres 16 with pgvector (HA regional, PITR, query insights)
- **MemoryStore** Redis 7.2 (STANDARD_HA)
- **Artifact Registry** for container images
- **Secret Manager** entries for LLM + Stripe + JWT secrets

## Usage

```bash
cd infra/terraform
cat > terraform.tfvars <<EOF
project_id = "your-gcp-project"
region     = "us-central1"
env        = "prod"
EOF

terraform init -backend-config="bucket=your-tfstate-bucket"
terraform plan -out=tfplan
terraform apply tfplan
```

After apply, fetch credentials:

```bash
gcloud container clusters get-credentials nexusai-prod --region us-central1
kubectl apply -f ../k8s/
```

## Intentionally out of scope

- **Kafka** — use Confluent Cloud or the Strimzi operator in-cluster
- **Neo4j** — AuraDB (managed) or Neo4j Helm chart
- **ClickHouse** — ClickHouse Cloud or Altinity operator
- **Grafana + Prometheus** — kube-prometheus-stack Helm chart, or Google Cloud Managed Prometheus

These are kept out so terraform state doesn't couple to their upgrade cadence.
