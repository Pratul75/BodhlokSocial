resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "worker_token" {
  length  = 40
  special = false
}

locals {
  generated_secrets = {
    "app-database-url" = local.database_url
    "app-auth-secret"  = random_password.auth_secret.result
    "app-worker-token" = random_password.worker_token.result
  }
}

resource "google_secret_manager_secret" "generated" {
  for_each  = local.generated_secrets
  secret_id = each.key
  labels    = { app = "bodh-growth-os" }
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.generated[each.key].id
  secret_data = each.value
}

# The OAuth client secret is added by hand so it never sits in Terraform variables:
#   printf '%s' "<client secret>" | gcloud secrets versions add app-google-client-secret --data-file=-
resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = "app-google-client-secret"
  labels    = { app = "bodh-growth-os" }
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}
