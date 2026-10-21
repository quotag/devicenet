# Firebase Hosting and Web App Configuration

resource "google_firebase_web_app" "web_app" {
  provider        = google-beta
  project         = var.gcp_project_id
  display_name    = "DeviceNet Web"
  deletion_policy = "DELETE"
  depends_on      = [google_project_service.apis]
}

resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.gcp_project_id
  site_id  = var.firebase_project_id

  depends_on = [
    google_project_service.apis,
    google_firebase_web_app.web_app
  ]
}

output "firebase_hosting_url" {
  value       = "https://${var.firebase_project_id}.web.app"
  description = "Primary URL of Firebase Hosting"
}
