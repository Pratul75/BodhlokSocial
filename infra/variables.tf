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

variable "tracking_scheduler_enabled" {
  description = "Run the tracking jobs: conversion forwarding, spend loading, GA4 sessions and funnel rebuilds."
  type        = bool
  default     = true
}

variable "ga4_bq_dataset" {
  description = "GA4 BigQuery export dataset, e.g. analytics_123456789. Empty skips GA4 sessions."
  type        = string
  default     = ""
}

variable "ga4_bq_project" {
  description = "Project holding the GA4 export. Defaults to this project."
  type        = string
  default     = ""
}

variable "google_ads_customer_id" {
  description = "Google Ads customer ID, digits only. Empty until the developer token is approved."
  type        = string
  default     = ""
}

variable "google_ads_login_customer_id" {
  description = "Manager account ID used to reach the customer, if any."
  type        = string
  default     = ""
}

variable "google_ads_conversion_actions" {
  description = "Conversion action IDs per event, as JSON: {\"registration\":\"123\",\"activation\":\"456\",\"paid\":\"789\"}."
  type        = string
  default     = "{}"
}

variable "postiz_domain" {
  description = "Public hostname for Postiz, e.g. postiz.rechargestudio.com. Empty skips the Postiz VM."
  type        = string
  default     = ""
}

variable "postiz_version" {
  description = "Postiz image tag (github.com/gitroomhq/postiz-app/releases)."
  type        = string
  default     = "v2.25.1"
}

variable "postiz_compose_commit" {
  description = "Commit of github.com/gitroomhq/postiz-docker-compose to run."
  type        = string
  default     = "dd4969e5e694cd009619a0d53cff14c21104580b"
}

variable "postiz_machine_type" {
  description = "Postiz runs Temporal and Elasticsearch beside it; 8 GB is the comfortable minimum."
  type        = string
  default     = "e2-standard-2"
}

variable "postiz_disable_registration" {
  description = "Set true after creating the team's Postiz account, so nobody else can sign up."
  type        = bool
  default     = false
}

variable "publishing_scheduler_enabled" {
  description = "Run the publisher every 5 minutes and check video generation every minute."
  type        = bool
  default     = true
}

variable "github_deploy_enabled" {
  description = "Let GitHub Actions deploy through Workload Identity Federation. Off: deploy from a laptop with scripts/deploy.sh."
  type        = bool
  default     = false
}
