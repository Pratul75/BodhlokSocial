terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }
  # State lives in a GCS bucket you create once (see infra/README.md):
  #   terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "bodh-growth-os"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
