# Networking and Firewall Configuration for DeviceNet

# Static External IP for EMQX Broker VM
resource "google_compute_address" "emqx_ip" {
  name   = "devicenet-emqx-ip"
  region = var.gcp_region
}

# Firewall: MQTTS port 8883 (Secure MQTT for Hub Agent)
resource "google_compute_firewall" "emqx_mqtts" {
  name    = "devicenet-emqx-mqtts"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["8883"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

# Firewall: WSS port 8084 (Secure WebSocket for Browser Web App)
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

# Firewall: HTTPS port 443 (Narrow Caddy client kick endpoint)
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

# Firewall: HTTP port 80 (Certbot ACME HTTP-01 standalone challenge)
resource "google_compute_firewall" "certbot_acme_http" {
  name    = "devicenet-certbot-acme"
  network = var.vm_network

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["emqx-server"]
}

# Note: Plain MQTT (1883), plain WS (8083), and Dashboard (18083)
# are intentionally NOT exposed on the public firewall.
# Dashboard is accessed securely via: gcloud compute ssh devicenet-emqx-vm -- -L 18083:localhost:18083

output "static_external_ip" {
  value       = google_compute_address.emqx_ip.address
  description = "Static external IP allocated for the EMQX VM"
}
