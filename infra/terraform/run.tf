resource "google_cloud_run_service" "api" {
  name     = "devicenet-api"
  location = var.gcp_region

  template {
    spec {
      containers {
        image = "gcr.io/${var.gcp_project_id}/devicenet-api:latest"

        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.firebase_project_id
        }

        env {
          name  = "DN_MQTT_HOST"
          value = google_compute_instance.emqx_vm.network_interface[0].access_config[0].nat_ip
        }

        env {
          name  = "DN_MQTT_PORT"
          value = "8883"
        }

        env {
          name  = "DN_MQTT_WSS_PORT"
          value = "8084"
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
        "autoscaling.knative.dev/minScale" = "0"
        "autoscaling.knative.dev/maxScale" = "2"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_project_service.run]
}

resource "google_service_account" "run_sa" {
  account_id   = "devicenet-api-sa"
  display_name = "DeviceNet API Service Account"
}

resource "google_project_iam_member" "run_sa_firestore" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

resource "google_project_iam_member" "run_sa_firebase_auth" {
  project = var.gcp_project_id
  role    = "roles/firebase.admin"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

resource "google_project_iam_member" "run_sa_secretmanager" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.run_sa.email}"
}

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

output "api_service_url" {
  value = google_cloud_run_service.api.status[0].url
}
