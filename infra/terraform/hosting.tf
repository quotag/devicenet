resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.gcp_project_id
  site_id  = var.firebase_project_id

  depends_on = [
    google_project_service.firebase_hosting,
    google_firebase_web_app.web_app
  ]
}

resource "google_project_service" "firebase_hosting" {
  service            = "firebasehosting.googleapis.com"
  disable_on_destroy = false
}

resource "google_firebase_web_app" "web_app" {
  provider            = google-beta
  project             = var.gcp_project_id
  display_name        = "DeviceNet Web"
  deletion_policy     = "DELETE"
  depends_on          = [google_project_service.firebase]
}

resource "google_project_service" "firebase" {
  service            = "firebase.googleapis.com"
  disable_on_destroy = false
}
