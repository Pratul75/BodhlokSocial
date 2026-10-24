locals {
  app_url = var.app_url != "" ? var.app_url : "https://bodh-web-${data.google_project.this.number}.${var.region}.run.app"
}

resource "google_cloud_run_v2_service" "web" {
  name                = "bodh-web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.web.email
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
    containers {
      image = local.web_image
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "1Gi" }
        cpu_idle = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "APP_URL"
        value = local.app_url
      }
      env {
        name  = "ALLOWED_EMAIL_DOMAINS"
        value = var.allowed_email_domains
      }
      env {
        name  = "GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }
      env {
        name  = "DB_SOCKET_DIR"
        value = local.db_socket_dir
      }
      env {
        name  = "DB_POOL_SIZE"
        value = "5"
      }
      env {
        name  = "SECRETS_BACKEND"
        value = "gcp"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "STORAGE_BACKEND"
        value = "gcs"
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.assets.name
      }
      env {
        name  = "SEARCH_CONSOLE_SITE"
        value = var.search_console_site
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.generated["app-database-url"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.generated["app-auth-secret"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds    = 5
        failure_threshold = 12
      }
      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds = 30
      }
    }
  }

  lifecycle {
    # GitHub Actions deploys new images; Terraform owns everything else.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.web_reads,
    google_secret_manager_secret_iam_member.web_reads_client_secret,
    google_project_iam_member.sql_client,
  ]
}

# The web app is public; it does its own Google sign-in and domain check.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "bodh-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.worker.email
    timeout         = "900s"
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
    containers {
      image = local.worker_image
      ports {
        container_port = 8080
      }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "DB_SOCKET_DIR"
        value = local.db_socket_dir
      }
      env {
        name  = "DB_POOL_SIZE"
        value = "5"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.generated["app-database-url"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "WORKER_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.generated["app-worker-token"].secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 5
        failure_threshold = 12
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.worker_reads, google_project_iam_member.sql_client]
}

# No public access: only the scheduler's identity can call the worker.
resource "google_cloud_run_v2_service_iam_member" "worker_scheduler" {
  name     = google_cloud_run_v2_service.worker.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Applies migrations, fills connection rows and spend caps, and creates the first admin.
resource "google_cloud_run_v2_job" "migrate" {
  name                = "bodh-migrate"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.worker.email
      max_retries     = 1
      timeout         = "600s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
      containers {
        image   = local.worker_image
        command = ["packages/db/node_modules/.bin/tsx"]
        args    = ["packages/db/src/migrate.ts"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "DB_SOCKET_DIR"
          value = local.db_socket_dir
        }
        env {
          name  = "BOOTSTRAP_ADMIN_EMAIL"
          value = var.bootstrap_admin_email
        }
        env {
          name  = "BOOTSTRAP_ADMIN_NAME"
          value = var.bootstrap_admin_name
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.generated["app-database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.worker_reads, google_project_iam_member.sql_client]
}
