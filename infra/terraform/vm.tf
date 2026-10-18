resource "google_compute_instance" "emqx_vm" {
  name         = "devicenet-emqx-vm"
  machine_type = var.vm_machine_type
  zone         = "${var.gcp_region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/${var.vm_image}"
      size  = 50
    }
  }

  network_interface {
    network = var.vm_network
    access_config {
      // Ephemeral IP
    }
  }

  metadata_startup_script = base64decode(base64encode(file("${path.module}/../vm/startup.sh")))

  metadata = {
    enable-oslogin = "true"
  }

  service_account {
    email  = google_service_account.vm_sa.email
    scopes = ["cloud-platform"]
  }

  tags = ["emqx-server"]
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

output "vm_external_ip" {
  value = google_compute_instance.emqx_vm.network_interface[0].access_config[0].nat_ip
}
