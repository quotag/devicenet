resource "google_firestore_database" "database" {
  name        = "(default)"
  location_id = var.gcp_region
  type        = "FIRESTORE_NATIVE"
  project     = var.gcp_project_id
  depends_on  = [google_project_service.apis]
}

resource "google_firestore_field" "private_secretHash" {
  database   = google_firestore_database.database.name
  collection = "private"
  field      = "secretHash"
  project    = var.gcp_project_id

  index_config {
    indexes {
      order       = "ASCENDING"
      query_scope = "COLLECTION_GROUP"
    }
  }
}

resource "google_firestore_field" "events_expireAt_ttl" {
  database   = google_firestore_database.database.name
  collection = "events"
  field      = "expireAt"
  project    = var.gcp_project_id

  ttl_config {}
}

resource "google_firestore_field" "claimCodes_expireAt_ttl" {
  database   = google_firestore_database.database.name
  collection = "claimCodes"
  field      = "expireAt"
  project    = var.gcp_project_id

  ttl_config {}
}
