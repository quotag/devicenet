resource "google_secret_manager_secret" "emqx_shared_token" {
  secret_id = "emqx-shared-token"
  project   = var.gcp_project_id

  replication {
    automatic = true
  }
}

resource "google_secret_manager_secret" "emqx_admin_key" {
  secret_id = "emqx-admin-key"
  project   = var.gcp_project_id

  replication {
    automatic = true
  }
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}
