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
| Cloud Scheduler | One job per agent schedule, in India time. Off until the agent runtime ships. |
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

## 7. Turn on deploys from GitHub

In the repository's **Settings > Secrets and variables > Actions > Variables**, add:

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | your project ID |
| `GCP_REGION` | `asia-south1` |
| `GCP_WIF_PROVIDER` | `terraform output -raw github_wif_provider` |
| `GCP_DEPLOYER_SA` | `terraform output -raw github_deployer_email` |

From then on, every push to `main` that passes CI builds both images, runs migrations, deploys and smoke tests.

## Notes

- **Org policy.** If your organization restricts `allUsers` on Cloud Run (domain restricted sharing), the web service's public invoker binding fails. Either allow it for this project, or put the app behind a load balancer with IAP.
- **Spend caps start at ₹0**, which blocks all ad spend. Set real caps in **Admin** before connecting Google Ads or Meta.
- **Agent schedules** are off. Set `scheduler_enabled = true` once the agent runtime ships in Phase 4.
- **Custom domain.** Map one in Cloud Run, set `app_url` to it, re-apply, and add its redirect URIs to the OAuth client.
