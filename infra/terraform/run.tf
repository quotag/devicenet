# Cloud Run Service and Artifact Registry Configuration for DeviceNet API

data "google_project" "current" {
  project_id = var.gcp_project_id
}

locals {
  resolved_mqtt_domain = var.mqtt_domain != "" ? var.mqtt_domain : "${google_compute_address.emqx_ip.address}.sslip.io"
  resolved_api_url     = var.api_base_url != "" ? var.api_base_url : "https://devicenet-api-${data.google_project.current.number}.${var.gcp_region}.run.app"
}

# Artifact Registry Repository for Docker images
resource "google_artifact_registry_repository" "api_repo" {
  location      = var.gcp_region
  repository_id = "devicenet"
  description   = "DeviceNet container images repository"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# Cloud Run Service for DeviceNet API
resource "google_cloud_run_service" "api" {
  name     = "devicenet-api"
  location = var.gcp_region

  template {
    spec {
      containers {
        image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/devicenet/api:${var.image_tag}"

        env {
          name  = "PORT"
          value = "8080"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "GCP_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.firebase_project_id
        }
        env {
          name  = "FIREBASE_WEB_API_KEY"
          value = var.firebase_web_api_key
        }
        env {
          name  = "DN_API_BASE_URL"
          value = local.resolved_api_url
        }
        env {
          name  = "TRUST_PROXY"
          value = "1"
        }
        env {
          name  = "DN_MQTT_HOST"
          value = local.resolved_mqtt_domain
        }
        env {
          name  = "DN_MQTT_PORT"
          value = "8883"
        }
        env {
          name  = "DN_MQTT_WSS_PORT"
          value = "8084"
        }
        env {
          name  = "HOSTING_ORIGIN"
          value = "https://${var.firebase_project_id}.web.app,https://${var.firebase_project_id}.firebaseapp.com"
        }
        env {
          name  = "EMQX_ADMIN_URL"
          value = "https://${local.resolved_mqtt_domain}"
        }

        # Secrets injected securely from Secret Manager
        env {
          name = "EMQX_SHARED_TOKEN"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.emqx_shared_token.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "EMQX_ADMIN_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.emqx_admin_key.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "EMQX_ADMIN_SECRET"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.emqx_admin_secret.secret_id
              key  = "latest"
            }
          }
        }

        startup_probe {
          http_get {
            path = "/healthz"
            port = 8080
          }
          initial_delay_seconds = 0
          timeout_seconds       = 3
          period_seconds        = 5
          failure_threshold     = 3
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      service_account_name = google_service_account.run_sa.email
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale"     = tostring(var.api_min_instances)
        "autoscaling.knative.dev/maxScale"     = tostring(var.api_max_instances)
        "run.googleapis.com/startup-cpu-boost" = "true"
        "run.googleapis.com/cpu-throttling"   = "true"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_service.apis,
    google_service_account_iam_member.run_sa_token_creator,
    google_artifact_registry_repository.api_repo
  ]
}

# Allow unauthenticated invocations for Cloud Run API (API performs its own token authentication)
resource "google_cloud_run_service_iam_member" "api_public_access" {
  location = google_cloud_run_service.api.location
  project  = google_cloud_run_service.api.project
  service  = google_cloud_run_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Dedicated Service Account for Cloud Run API
resource "google_service_account" "run_sa" {
  account_id   = "devicenet-api-sa"
  display_name = "DeviceNet API Service Account"
}

# Firestore Data Access
resource "google_project_iam_member" "run_sa_firestore" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

# Firebase Auth Administration (User lookups, custom claims)
resource "google_project_iam_member" "run_sa_firebase_auth" {
  project = var.gcp_project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

# Required for firebase-admin auth().createCustomToken()
resource "google_service_account_iam_member" "run_sa_token_creator" {
  service_account_id = google_service_account.run_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.run_sa.email}"
}

# Scoped Secret Manager Access per secret
resource "google_secret_manager_secret_iam_member" "run_sa_emqx_shared_token" {
  secret_id = google_secret_manager_secret.emqx_shared_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "run_sa_emqx_admin_key" {
  secret_id = google_secret_manager_secret.emqx_admin_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "run_sa_emqx_admin_secret" {
  secret_id = google_secret_manager_secret.emqx_admin_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_sa.email}"
}

output "api_service_url" {
  value       = google_cloud_run_service.api.status[0].url
  description = "The HTTPS URL of the deployed Cloud Run DeviceNet API"
}
