# Every scheduled worker call, in India time. This list mirrors the VM timers in
# scripts/vm/systemd/*.timer one for one (same paths, same times); scripts/check-schedules.sh
# fails CI if the two drift apart.
locals {
  agent_jobs = {
    "agent-content"         = { path = "/jobs/content?trigger=schedule", cron = "0 6 * * *" }
    "agent-ads"             = { path = "/jobs/ads?trigger=schedule", cron = "30 7 * * *" }
    "agent-seo"             = { path = "/jobs/seo?trigger=schedule", cron = "0 7 * * 1" }
    "agent-strategy"        = { path = "/jobs/strategy?trigger=schedule", cron = "0 9 25 * *" }
    "agent-community"       = { path = "/jobs/community?trigger=schedule", cron = "0 8 * * *" }
    "agent-mentions"        = { path = "/jobs/mentions?trigger=schedule", cron = "0 5 * * 2" }
    "agent-analyst"         = { path = "/jobs/analyst?trigger=schedule", cron = "0 9 * * 1" }
    "agent-analyst-monthly" = { path = "/jobs/analyst?trigger=schedule", cron = "30 9 1 * *" }
  }
  tracking_jobs = {
    "tracking-forward" = { path = "/jobs/tracking/forward-conversions", cron = "*/5 * * * *" }
    "tracking-hourly"  = { path = "/jobs/tracking/hourly", cron = "10 * * * *" }
    "tracking-daily"   = { path = "/jobs/tracking/daily", cron = "30 6 * * *" }
    "ads-sync"         = { path = "/jobs/ads/sync", cron = "15 * * * *" }
  }
  publishing_jobs = {
    "publisher"     = { path = "/jobs/publishing/run", cron = "*/5 * * * *" }
    "creative-poll" = { path = "/jobs/creative/poll", cron = "* * * * *" }
  }
  seo_jobs = {
    "seo-keywords"    = { path = "/jobs/seo/keywords", cron = "0 5 * * 1" }
    "seo-audit-start" = { path = "/jobs/seo/audit-start", cron = "0 2 * * 0" }
    "seo-audit-poll"  = { path = "/jobs/seo/audit-poll", cron = "20 * * * *" }
    "geo"             = { path = "/jobs/seo/geo", cron = "0 8 * * 1" }
    "site-publish"    = { path = "/jobs/site/publish", cron = "*/30 * * * *" }
    "site-sync"       = { path = "/jobs/site/sync", cron = "0 * * * *" }
  }
  ops_jobs = {
    "ops-alerts" = { path = "/jobs/ops/alerts", cron = "0 9 * * *" }
    "crm-sync"   = { path = "/jobs/crm/sync", cron = "30 2 * * *" }
  }

  scheduled_jobs = merge(
    var.scheduler_enabled ? local.agent_jobs : {},
    var.tracking_scheduler_enabled ? local.tracking_jobs : {},
    var.publishing_scheduler_enabled ? local.publishing_jobs : {},
    var.seo_scheduler_enabled ? local.seo_jobs : {},
    local.ops_jobs,
  )
}

resource "google_cloud_scheduler_job" "worker" {
  for_each         = local.scheduled_jobs
  name             = "bodh-${each.key}"
  region           = var.region
  schedule         = each.value.cron
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "600s"

  retry_config {
    # Agent starts answer 409 while a run is going; retrying those only adds noise.
    retry_count          = startswith(each.key, "agent-") ? 0 : 2
    min_backoff_duration = "60s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}${each.value.path}"
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

# The earlier per-group resources become one; keep existing jobs instead of recreating them.
moved {
  from = google_cloud_scheduler_job.tracking["tracking-forward"]
  to   = google_cloud_scheduler_job.worker["tracking-forward"]
}
moved {
  from = google_cloud_scheduler_job.tracking["tracking-hourly"]
  to   = google_cloud_scheduler_job.worker["tracking-hourly"]
}
moved {
  from = google_cloud_scheduler_job.tracking["tracking-daily"]
  to   = google_cloud_scheduler_job.worker["tracking-daily"]
}
moved {
  from = google_cloud_scheduler_job.publishing["publisher"]
  to   = google_cloud_scheduler_job.worker["publisher"]
}
moved {
  from = google_cloud_scheduler_job.publishing["creative-poll"]
  to   = google_cloud_scheduler_job.worker["creative-poll"]
}
