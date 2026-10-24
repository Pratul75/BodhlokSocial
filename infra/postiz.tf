# Postiz, the social scheduler, on one VM with the official Docker Compose stack
# (Postiz, Postgres, Redis, Temporal, Elasticsearch) and Caddy in front for HTTPS.
# After apply: point DNS for var.postiz_domain at output postiz_ip, open https://<domain>,
# create the team account, set postiz_disable_registration = true, and re-apply.

locals {
  postiz_on = var.postiz_domain != ""
}

resource "google_project_service" "compute" {
  count              = local.postiz_on ? 1 : 0
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "random_password" "postiz" {
  for_each = local.postiz_on ? toset(["jwt", "postgres"]) : toset([])
  length   = 40
  special  = false
}

resource "google_secret_manager_secret" "postiz_generated" {
  for_each  = local.postiz_on ? toset(["jwt", "postgres"]) : toset([])
  secret_id = "postiz-${each.key}"
  labels    = { app = "bodh-growth-os" }
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "postiz_generated" {
  for_each    = google_secret_manager_secret.postiz_generated
  secret      = each.value.id
  secret_data = random_password.postiz[each.key].result
}

# Social platform app keys for Postiz, as a dotenv file. Added by hand:
#   gcloud secrets versions add postiz-env --data-file=postiz.env
# with lines like FACEBOOK_APP_ID=..., FACEBOOK_APP_SECRET=..., LINKEDIN_CLIENT_ID=...,
# YOUTUBE_CLIENT_ID=... (see docs.postiz.com/providers). Re-run the startup script after.
resource "google_secret_manager_secret" "postiz_env" {
  count     = local.postiz_on ? 1 : 0
  secret_id = "postiz-env"
  labels    = { app = "bodh-growth-os" }
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "postiz" {
  count        = local.postiz_on ? 1 : 0
  account_id   = "bodh-postiz"
  display_name = "Postiz VM"
}

resource "google_secret_manager_secret_iam_member" "postiz_reads" {
  for_each  = local.postiz_on ? { jwt = google_secret_manager_secret.postiz_generated["jwt"].id, postgres = google_secret_manager_secret.postiz_generated["postgres"].id, env = google_secret_manager_secret.postiz_env[0].id } : {}
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postiz[0].email}"
}

resource "google_project_iam_member" "postiz_logs" {
  for_each = local.postiz_on ? toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"]) : toset([])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.postiz[0].email}"
}

resource "google_compute_address" "postiz" {
  count      = local.postiz_on ? 1 : 0
  name       = "bodh-postiz"
  region     = var.region
  depends_on = [google_project_service.compute]
}

resource "google_compute_firewall" "postiz_web" {
  count         = local.postiz_on ? 1 : 0
  name          = "bodh-postiz-web"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["bodh-postiz"]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  depends_on = [google_project_service.compute]
}

# SSH only through Identity-Aware Proxy: gcloud compute ssh bodh-postiz --tunnel-through-iap
resource "google_compute_firewall" "postiz_iap_ssh" {
  count         = local.postiz_on ? 1 : 0
  name          = "bodh-postiz-iap-ssh"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["bodh-postiz"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  depends_on = [google_project_service.compute]
}

resource "google_compute_instance" "postiz" {
  count                     = local.postiz_on ? 1 : 0
  name                      = "bodh-postiz"
  zone                      = "${var.region}-a"
  machine_type              = var.postiz_machine_type
  tags                      = ["bodh-postiz"]
  allow_stopping_for_update = true

  boot_disk {
    auto_delete = false # keeps Postiz's databases and uploads if the VM is replaced
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 60
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.postiz[0].address
    }
  }

  service_account {
    email  = google_service_account.postiz[0].email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot = true
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = templatefile("${path.module}/postiz-startup.sh.tftpl", {
      domain               = var.postiz_domain
      image                = "ghcr.io/gitroomhq/postiz-app:${var.postiz_version}"
      compose_commit       = var.postiz_compose_commit
      disable_registration = var.postiz_disable_registration ? "true" : "false"
      project              = var.project_id
    })
  }

  depends_on = [google_secret_manager_secret_iam_member.postiz_reads, google_secret_manager_secret_version.postiz_generated]
}

output "postiz_ip" {
  description = "Point an A record for postiz_domain here."
  value       = local.postiz_on ? google_compute_address.postiz[0].address : null
}

output "postiz_api_url" {
  description = "Paste into Connections > Postiz, with an API key from Postiz Settings."
  value       = local.postiz_on ? "https://${var.postiz_domain}/api/public/v1" : null
}
