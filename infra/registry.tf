resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "bodh"
  format        = "DOCKER"
  description   = "BODH Growth OS images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  depends_on = [google_project_service.enabled]
}

locals {
  registry     = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  web_image    = "${local.registry}/web:${var.image_tag}"
  worker_image = "${local.registry}/worker:${var.image_tag}"
}
