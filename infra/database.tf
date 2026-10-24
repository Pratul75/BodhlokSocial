resource "google_sql_database_instance" "main" {
  name                = "bodh"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "21:00" # 02:30 IST
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      # Public IP with no authorized networks: only the Cloud SQL connector
      # (Cloud Run's /cloudsql socket) can connect.
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "app" {
  name     = "bodh"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = "bodh"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

locals {
  db_socket_dir = "/cloudsql/${google_sql_database_instance.main.connection_name}"
  # Host is ignored when DB_SOCKET_DIR is set; the socket carries the connection.
  database_url = "postgres://${google_sql_user.app.name}:${random_password.db.result}@localhost/${google_sql_database.app.name}"
}
