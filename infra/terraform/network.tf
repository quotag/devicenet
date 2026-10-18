resource "google_compute_firewall" "emqx_mqtt" {
  name    = "devicenet-emqx-mqtt"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["8883"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

resource "google_compute_firewall" "emqx_wss" {
  name    = "devicenet-emqx-wss"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["8084"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

resource "google_compute_firewall" "caddy_https" {
  name    = "devicenet-caddy-https"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

resource "google_compute_firewall" "caddy_http" {
  name    = "devicenet-caddy-http"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

resource "google_compute_firewall" "emqx_admin" {
  name    = "devicenet-emqx-admin"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["18083"]
  }

  source_ranges = [var.admin_ip]
  target_tags   = ["emqx-server"]
}
