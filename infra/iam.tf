resource "google_service_account" "web" {
  account_id   = "bodh-web"
  display_name = "BODH Growth OS web app"
}

resource "google_service_account" "worker" {
  account_id   = "bodh-worker"
  display_name = "BODH Growth OS worker and migrations"
}

resource "google_service_account" "scheduler" {
  account_id   = "bodh-scheduler"
  display_name = "Cloud Scheduler caller for the worker"
}

locals {
  integration_secret_prefix = "projects/${data.google_project.this.number}/secrets/integration-"
}

# Both services reach Cloud SQL through the connector.
resource "google_project_iam_member" "sql_client" {
  for_each = {
    web    = google_service_account.web.email
    worker = google_service_account.worker.email
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

# The web app creates, updates and deletes integration secrets (API keys, OAuth grants),
# limited by condition to secrets named integration-*.
resource "google_project_iam_member" "web_integration_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.web.email}"
  condition {
    title      = "integration-secrets-only"
    expression = "resource.name.startsWith(\"${local.integration_secret_prefix}\")"
  }
}

# The worker reads integration secrets but can't change them.
resource "google_project_iam_member" "worker_integration_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.worker.email}"
  condition {
    title      = "integration-secrets-only"
    expression = "resource.name.startsWith(\"${local.integration_secret_prefix}\")"
  }
}

# Runtime config secrets, read at startup.
resource "google_secret_manager_secret_iam_member" "web_reads" {
  for_each  = toset(["app-database-url", "app-auth-secret", "app-bodh-events-secret"])
  secret_id = google_secret_manager_secret.generated[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

resource "google_secret_manager_secret_iam_member" "web_reads_client_secret" {
  secret_id = google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_reads" {
  for_each  = toset(["app-database-url", "app-worker-token"])
  secret_id = google_secret_manager_secret.generated[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# Uploads, and signing short-lived download URLs with the web app's own identity.
resource "google_storage_bucket_iam_member" "web_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.web.email}"
}

resource "google_service_account_iam_member" "web_signs_urls" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.web.email}"
}

resource "google_storage_bucket_iam_member" "worker_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# The worker refreshes Google OAuth grants (Google Ads) and reads the developer token.
resource "google_secret_manager_secret_iam_member" "worker_reads_client_secret" {
  secret_id = google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "ads_token_reads" {
  for_each = {
    web    = google_service_account.web.email
    worker = google_service_account.worker.email
  }
  secret_id = google_secret_manager_secret.google_ads_developer_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
}

# GA4 sessions: run BigQuery jobs here and read the GA4 export dataset.
resource "google_project_iam_member" "worker_bq_jobs" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_bigquery_dataset_iam_member" "worker_reads_ga4" {
  count      = var.ga4_bq_dataset != "" ? 1 : 0
  project    = var.ga4_bq_project != "" ? var.ga4_bq_project : var.project_id
  dataset_id = var.ga4_bq_dataset
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.worker.email}"
}

# Image and video generation with Vertex AI, using each service's own identity.
resource "google_project_iam_member" "vertex_users" {
  for_each = {
    web    = google_service_account.web.email
    worker = google_service_account.worker.email
  }
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${each.value}"
}

# The worker stores finished videos in the assets bucket.
resource "google_storage_bucket_iam_member" "worker_writes_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.worker.email}"
}
