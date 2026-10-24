# Deploying to GCP

Terraform in this folder creates everything the app runs on, in one GCP project:

| Piece | What it is |
|---|---|
| Cloud Run `bodh-web` | The web app. Public, with Google sign-in limited to your domain. |
| Cloud Run `bodh-worker` | Agent job endpoints. Private: only the scheduler's identity can call it. |
| Cloud Run job `bodh-migrate` | Applies database migrations and creates the first admin. Runs on every deploy. |
| Cloud SQL `bodh` | Postgres 16, daily backups, point-in-time recovery, reachable only through the Cloud SQL connector. |
| Secret Manager | Database URL, session secret, worker token, OAuth client secret, and every integration key or grant. |
| Cloud Storage | Uploaded images and videos, private, served through 15-minute signed links. |
| Artifact Registry `bodh` | Container images. |
| Cloud Scheduler | Tracking jobs (every 5 minutes, hourly, daily), and one job per agent schedule, off until the agent runtime ships. All in India time. |
| Workload Identity Federation | Lets GitHub Actions on `main` deploy without a stored key. |

You need `gcloud`, Terraform 1.6 or later, and Docker.

## 1. Create the project and the state bucket

```bash
gcloud projects create <project-id>
gcloud billing projects link <project-id> --billing-account <billing-account-id>
gcloud config set project <project-id>
gcloud auth application-default login
gcloud storage buckets create gs://<project-id>-tfstate --location asia-south1 --uniform-bucket-level-access
```

## 2. Create the OAuth client

In the console, open **Google Auth Platform** for the project:

1. **Branding**: app name "BODH Growth", support email, your domain under authorized domains.
2. **Audience**: choose **Internal**, so only your Workspace accounts can sign in and no Google review is needed.
3. **Data access**: add the scopes `openid`, `email`, `profile` and `https://www.googleapis.com/auth/webmasters.readonly`.
4. **Clients**: create a **Web application** client. Leave the redirect URIs for step 5.

Keep the client ID for the next step and the client secret for step 4.

## 3. Configure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in project_id, google_client_id, bootstrap_admin_email
terraform init -backend-config="bucket=<project-id>-tfstate"
```

## 4. Create the registry and secrets, then add the OAuth client secret

```bash
terraform apply -target=google_project_service.enabled -target=google_artifact_registry_repository.images \
  -target=google_secret_manager_secret.google_client_secret
printf '%s' '<client secret>' | gcloud secrets versions add app-google-client-secret --data-file=-
```

## 5. Push the first images, then apply everything

```bash
cd ..
REG=asia-south1-docker.pkg.dev/<project-id>/bodh
gcloud auth configure-docker asia-south1-docker.pkg.dev
docker build --platform linux/amd64 --target web -t $REG/web:latest . && docker push $REG/web:latest
docker build --platform linux/amd64 --target worker -t $REG/worker:latest . && docker push $REG/worker:latest
cd infra && terraform apply
```

Cloud SQL takes about ten minutes to create. When it finishes, add both URIs from `terraform output oauth_redirect_uris` to the OAuth client's **Authorized redirect URIs**.

## 6. Create the database and the first admin

```bash
gcloud run jobs execute bodh-migrate --region asia-south1 --wait
```

Open `terraform output -raw app_url` and sign in with the `bootstrap_admin_email` account. Add the rest of the team in **Admin**.

## 7. Optional: deploys from GitHub

Off by default. Set `github_deploy_enabled = true` to create the keyless GitHub access, then:

In the repository's **Settings > Secrets and variables > Actions > Variables**, add:

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | your project ID |
| `GCP_REGION` | `asia-south1` |
| `GCP_WIF_PROVIDER` | `terraform output -raw github_wif_provider` |
| `GCP_DEPLOYER_SA` | `terraform output -raw github_deployer_email` |

From then on, every push to `main` that passes CI builds both images, runs migrations, deploys and smoke tests.

## 8. Turn on tracking

Tracking jobs run on their own from the first deploy and skip any source that isn't connected.

- **BODH backend events.** Give the BODH backend's service account read access to the signing secret, then send them [docs/bodh-events.md](../docs/bodh-events.md) and the URL from `terraform output -raw bodh_events_endpoint`:

  ```bash
  gcloud secrets add-iam-policy-binding app-bodh-events-secret \
    --member serviceAccount:<bodh-backend-sa> --role roles/secretmanager.secretAccessor
  ```

- **Meta.** In Connections, add the Conversions API dataset ID and token, and the Marketing API ad account ID and system user token.
- **GA4.** In GA4, link the property to BigQuery (Admin > BigQuery links, daily export). Set `ga4_bq_dataset` to the dataset it creates (`analytics_<property id>`) and re-apply.
- **Google Ads**, once the developer token is approved: add it with
  `printf '%s' '<token>' | gcloud secrets versions add app-google-ads-developer-token --data-file=-`,
  set `google_ads_customer_id` and `google_ads_conversion_actions`, and re-apply.

## 9. Postiz, for publishing

Set `postiz_domain` (e.g. `postiz.rechargestudio.com`) and re-apply. Terraform creates a VM running Postiz with HTTPS.

1. Point an A record for the domain at `terraform output -raw postiz_ip`. HTTPS starts once DNS resolves.
2. Add the social platforms' app keys: write a `postiz.env` with `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, then `gcloud secrets versions add postiz-env --data-file=postiz.env` and restart: `gcloud compute ssh bodh-postiz --tunnel-through-iap -- sudo google_metadata_script_runner startup`.
3. Open `https://<domain>`, create the team account, connect Instagram, Facebook, LinkedIn and YouTube, and create an API key under Settings.
4. Set `postiz_disable_registration = true` and re-apply.
5. In Growth OS: Connections > Postiz takes `terraform output -raw postiz_api_url` and the key. Publishing then lists the Postiz channels to choose from.

## Notes

- **Org policy.** If your organization restricts `allUsers` on Cloud Run (domain restricted sharing), the web service's public invoker binding fails. Either allow it for this project, or put the app behind a load balancer with IAP.
- **Spend caps start at ₹0**, which blocks all ad spend. Set real caps in **Admin** before connecting Google Ads or Meta.
- **Agent schedules** are off. Set `scheduler_enabled = true` once the agent runtime ships in Phase 4.
- **Custom domain.** Map one in Cloud Run, set `app_url` to it, re-apply, and add its redirect URIs to the OAuth client.
