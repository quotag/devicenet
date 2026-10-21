variable "gcp_project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "gcp_region" {
  type        = string
  default     = "asia-southeast1"
  description = "GCP Region for Cloud Run, Compute Engine, and Artifact Registry"
}

variable "firebase_project_id" {
  type        = string
  description = "Firebase Project ID (typically matches gcp_project_id)"
}

variable "firebase_web_api_key" {
  type        = string
  description = "Firebase Web API key (public key used in client configs and hub credentials)"
}

variable "mqtt_domain" {
  type        = string
  default     = ""
  description = "Domain name for EMQX TLS certificate (e.g. mqtt.example.com or duckdns). If left blank, defaults to <static_ip>.sslip.io."
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Tag of the DeviceNet API image in Artifact Registry"
}

variable "api_min_instances" {
  type        = number
  default     = 0
  description = "Minimum instances for Cloud Run (0 enables scale-to-zero to minimize cost; 1 avoids cold starts)"
}

variable "api_max_instances" {
  type        = number
  default     = 3
  description = "Maximum instances for Cloud Run to prevent unexpected billing spikes"
}

variable "vm_machine_type" {
  type        = string
  default     = "e2-small"
  description = "GCE machine type for EMQX. e2-small (2GB RAM) is strongly recommended; e2-micro (1GB RAM) requires swap"
}

variable "vm_image" {
  type        = string
  default     = "debian-12"
  description = "GCE Debian image family"
}

variable "vm_network" {
  type        = string
  default     = "default"
  description = "VPC network name"
}
