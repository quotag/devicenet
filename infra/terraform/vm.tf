# Compute Engine VM Configuration for EMQX Broker

resource "google_compute_instance" "emqx_vm" {
  name         = "devicenet-emqx-vm"
  machine_type = var.vm_machine_type
  zone         = "${var.gcp_region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/${var.vm_image}"
      size  = 25
      type  = "pd-standard"
    }
  }

  network_interface {
    network = var.vm_network
    access_config {
      nat_ip = google_compute_address.emqx_ip.address
    }
  }

  metadata_startup_script = file("${path.module}/../vm/startup.sh")

  metadata = {
    enable-oslogin = "true"
  }

  service_account {
    email  = google_service_account.vm_sa.email
    scopes = ["cloud-platform"]
  }

  tags = ["emqx-server"]

  depends_on = [
    google_project_service.apis,
    google_compute_address.emqx_ip
  ]
}

resource "google_service_account" "vm_sa" {
  account_id   = "devicenet-emqx-vm-sa"
  display_name = "DeviceNet EMQX VM Service Account"
}

resource "google_project_iam_member" "vm_sa_log_writer" {
  project = var.gcp_project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm_sa.email}"
}

resource "google_project_iam_member" "vm_sa_metric_writer" {
  project = var.gcp_project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.vm_sa.email}"
}

resource "google_project_iam_member" "vm_sa_secret_accessor" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.vm_sa.email}"
}

output "vm_external_ip" {
  value       = google_compute_address.emqx_ip.address
  description = "Static external IP bound to the EMQX VM"
}

output "vm_mqtt_domain" {
  value       = var.mqtt_domain != "" ? var.mqtt_domain : "${google_compute_address.emqx_ip.address}.sslip.io"
  description = "Resolved MQTT domain used for TLS and client connections"
}
