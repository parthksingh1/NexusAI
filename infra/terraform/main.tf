terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  backend "gcs" {
    prefix = "nexusai/terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" { type = string }
variable "region"     { type = string, default = "us-central1" }
variable "env"        { type = string, default = "prod" }

# ─── GKE Autopilot cluster ──────────────────────────────────────
resource "google_container_cluster" "nexusai" {
  name                = "nexusai-${var.env}"
  location            = var.region
  enable_autopilot    = true
  deletion_protection = true

  ip_allocation_policy {}

  release_channel { channel = "REGULAR" }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}

# ─── Cloud SQL (Postgres 16 with pgvector) ──────────────────────
resource "google_sql_database_instance" "postgres" {
  name             = "nexus-pg-${var.env}"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = "db-custom-4-16384"
    availability_type = "REGIONAL"
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }
    database_flags { name = "cloudsql.enable_pgvector" value = "on" }
    insights_config { query_insights_enabled = true }
  }
  deletion_protection = true
}

resource "google_sql_database" "nexusai" {
  name     = "nexusai"
  instance = google_sql_database_instance.postgres.name
}

# ─── MemoryStore Redis ──────────────────────────────────────────
resource "google_redis_instance" "cache" {
  name           = "nexus-redis-${var.env}"
  memory_size_gb = 5
  tier           = "STANDARD_HA"
  region         = var.region
  redis_version  = "REDIS_7_2"
}

# ─── Artifact Registry ──────────────────────────────────────────
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "nexusai"
  format        = "DOCKER"
}

# ─── Secret Manager entries (create via console/gcloud) ─────────
resource "google_secret_manager_secret" "llm_keys" {
  for_each  = toset(["anthropic-api-key", "openai-api-key", "google-api-key", "stripe-secret", "jwt-secret"])
  secret_id = each.key
  replication { auto {} }
}

# ─── Outputs ────────────────────────────────────────────────────
output "cluster_name"  { value = google_container_cluster.nexusai.name }
output "sql_host"      { value = google_sql_database_instance.postgres.private_ip_address }
output "redis_host"    { value = google_redis_instance.cache.host }
output "registry_repo" { value = google_artifact_registry_repository.images.name }
