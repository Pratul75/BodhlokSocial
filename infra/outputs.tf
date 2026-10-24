output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "app_url" {
  description = "The URL Google redirects back to. Register its callbacks on the OAuth client."
  value       = local.app_url
}

output "oauth_redirect_uris" {
  value = ["${local.app_url}/api/auth/callback/google", "${local.app_url}/api/connect/google/callback"]
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "registry" {
  value = local.registry
}

output "migrate_job" {
  value = google_cloud_run_v2_job.migrate.name
}

output "assets_bucket" {
  value = google_storage_bucket.assets.name
}

output "github_wif_provider" {
  description = "Set as the GCP_WIF_PROVIDER repository variable in GitHub."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_email" {
  description = "Set as the GCP_DEPLOYER_SA repository variable in GitHub."
  value       = google_service_account.deployer.email
}

output "bodh_events_endpoint" {
  description = "Where the BODH backend sends signed events. The secret is app-bodh-events-secret."
  value       = "${local.app_url}/api/events/bodh"
}
