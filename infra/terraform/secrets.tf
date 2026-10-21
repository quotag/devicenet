# Secret Manager Secrets for DeviceNet

resource "google_secret_manager_secret" "emqx_shared_token" {
  secret_id = "emqx-shared-token"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "random_password" "emqx_shared_token" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret_version" "emqx_shared_token" {
  secret      = google_secret_manager_secret.emqx_shared_token.id
  secret_data = random_password.emqx_shared_token.result
}

resource "google_secret_manager_secret" "emqx_admin_key" {
  secret_id = "emqx-admin-key"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "random_password" "emqx_admin_key" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret_version" "emqx_admin_key" {
  secret      = google_secret_manager_secret.emqx_admin_key.id
  secret_data = random_password.emqx_admin_key.result
}

resource "google_secret_manager_secret" "emqx_admin_secret" {
  secret_id = "emqx-admin-secret"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "random_password" "emqx_admin_secret" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret_version" "emqx_admin_secret" {
  secret      = google_secret_manager_secret.emqx_admin_secret.id
  secret_data = random_password.emqx_admin_secret.result
}

resource "google_secret_manager_secret" "emqx_dashboard_password" {
  secret_id = "emqx-dashboard-password"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "random_password" "emqx_dashboard_password" {
  length  = 20
  special = false
}

resource "google_secret_manager_secret_version" "emqx_dashboard_password" {
  secret      = google_secret_manager_secret.emqx_dashboard_password.id
  secret_data = random_password.emqx_dashboard_password.result
}

resource "google_secret_manager_secret" "firebase_project_id" {
  secret_id = "firebase-project-id"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "firebase_project_id" {
  secret      = google_secret_manager_secret.firebase_project_id.id
  secret_data = var.firebase_project_id
}

output "generated_dashboard_password" {
  value       = random_password.emqx_dashboard_password.result
  sensitive   = true
  description = "Auto-generated initial password for EMQX dashboard admin user"
}

output "generated_emqx_admin_key" {
  value       = random_password.emqx_admin_key.result
  sensitive   = true
  description = "Auto-generated admin key for EMQX"
}

output "generated_emqx_admin_secret" {
  value       = random_password.emqx_admin_secret.result
  sensitive   = true
  description = "Auto-generated admin secret for EMQX"
}
