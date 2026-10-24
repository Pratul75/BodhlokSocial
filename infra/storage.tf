resource "google_storage_bucket" "assets" {
  name                        = "${var.project_id}-bodh-assets"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.enabled]
}
