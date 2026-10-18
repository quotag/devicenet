resource "google_firestore_database" "database" {
  name            = "(default)"
  location_id     = var.gcp_region
  type            = "FIRESTORE_NATIVE"
  project         = var.gcp_project_id
  depends_on      = [google_project_service.firestore]
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_index" "devices_hub_status" {
  collection = "devices"
  database   = google_firestore_database.database.name
  project    = var.gcp_project_id

  fields {
    field_path = "hubId"
    order      = "ASCENDING"
  }

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "rules_hub_enabled" {
  collection = "rules"
  database   = google_firestore_database.database.name
  project    = var.gcp_project_id

  fields {
    field_path = "hubId"
    order      = "ASCENDING"
  }

  fields {
    field_path = "enabled"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "events_ts" {
  collection = "events"
  database   = google_firestore_database.database.name
  project    = var.gcp_project_id

  fields {
    field_path = "ts"
    order      = "DESCENDING"
  }
}

resource "google_firestore_field" "events_expireAt_ttl" {
  database   = google_firestore_database.database.name
  collection = "events"
  field      = "expireAt"
  project    = var.gcp_project_id

  ttl_config {
  }
}
