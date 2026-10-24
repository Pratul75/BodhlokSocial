# Agent schedules from the build plan, in India time. Off until the agent runtime ships
# (Phase 4); until then each call only records a queued run.
locals {
  agent_schedules = {
    "content-daily"    = { agent = "content", cron = "0 6 * * *" }
    "ads-daily"        = { agent = "ads", cron = "0 7 * * *" }
    "community-daily"  = { agent = "community", cron = "0 8 * * *" }
    "publisher-15min"  = { agent = "publisher", cron = "*/15 * * * *" }
    "seo-weekly"       = { agent = "seo", cron = "0 5 * * 1" }
    "geo-weekly"       = { agent = "geo", cron = "30 5 * * 1" }
    "mentions-weekly"  = { agent = "mentions", cron = "0 5 * * 2" }
    "analyst-weekly"   = { agent = "analyst", cron = "0 9 * * 1" }
    "analyst-monthly"  = { agent = "analyst", cron = "0 9 1 * *" }
    "strategy-monthly" = { agent = "strategy", cron = "0 9 25 * *" }
  }
}

resource "google_cloud_scheduler_job" "agents" {
  for_each  = var.scheduler_enabled ? local.agent_schedules : {}
  name      = "bodh-${each.key}"
  region    = var.region
  schedule  = each.value.cron
  time_zone = "Asia/Kolkata"

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/jobs/${each.value.agent}?trigger=schedule"
    headers = {
      "X-Worker-Token" = random_password.worker_token.result
    }
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_scheduler]
}

# Tracking jobs. They skip themselves cleanly until each account is connected.
locals {
  tracking_schedules = {
    "tracking-forward" = { job = "forward-conversions", cron = "*/5 * * * *" }
    "tracking-hourly"  = { job = "hourly", cron = "10 * * * *" }
    "tracking-daily"   = { job = "daily", cron = "30 6 * * *" }
  }
}

resource "google_cloud_scheduler_job" "tracking" {
  for_each         = var.tracking_scheduler_enabled ? local.tracking_schedules : {}
  name             = "bodh-${each.key}"
  region           = var.region
  schedule         = each.value.cron
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "600s"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/jobs/tracking/${each.value.job}"
    headers = {
      "X-Worker-Token" = random_password.worker_token.result
    }
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_scheduler]
}
