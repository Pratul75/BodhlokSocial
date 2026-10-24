variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry and the bucket."
  type        = string
  default     = "asia-south1" # Mumbai
}

variable "allowed_email_domains" {
  description = "Google Workspace domains allowed to sign in, comma separated."
  type        = string
  default     = "rechargestudio.com"
}

variable "bootstrap_admin_email" {
  description = "First admin, created by the migrate job when no admin exists yet."
  type        = string
}

variable "bootstrap_admin_name" {
  description = "Display name for the first admin."
  type        = string
  default     = ""
}

variable "google_client_id" {
  description = "OAuth client ID (APIs & Services > Credentials). Its secret goes in Secret Manager, see README."
  type        = string
}

variable "app_url" {
  description = "Public URL of the web app. Leave empty to use the Cloud Run URL."
  type        = string
  default     = ""
}

variable "search_console_site" {
  description = "Search Console property to sync, for example sc-domain:asttrolok.com. Empty picks one automatically."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Image tag for the first deploy. Later deploys come from GitHub Actions."
  type        = string
  default     = "latest"
}

variable "db_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "github_repository" {
  description = "GitHub repository allowed to deploy, as owner/name."
  type        = string
  default     = "Pratul75/BodhlokSocial"
}

variable "scheduler_enabled" {
  description = "Create Cloud Scheduler jobs for the agents. Off until the agent runtime ships."
  type        = bool
  default     = false
}
