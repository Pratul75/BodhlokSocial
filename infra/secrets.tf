resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "bodh_events_secret" {
  length  = 48
  special = false
}

resource "random_password" "worker_token" {
  length  = 40
  special = false
}

locals {
  generated_secrets = {
    "app-database-url"       = local.database_url
    "app-auth-secret"        = random_password.auth_secret.result
    "app-worker-token"       = random_password.worker_token.result
    "app-bodh-events-secret" = random_password.bodh_events_secret.result
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

# The Google Ads developer token, added by hand once approved:
#   printf '%s' "<token>" | gcloud secrets versions add app-google-ads-developer-token --data-file=-
# Services only read it when google_ads_customer_id is set.
resource "google_secret_manager_secret" "google_ads_developer_token" {
  secret_id = "app-google-ads-developer-token"
  labels    = { app = "bodh-growth-os" }
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}
