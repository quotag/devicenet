variable "gcp_project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "gcp_region" {
  type        = string
  default     = "asia-southeast1"
  description = "GCP Region"
}

variable "admin_ip" {
  type        = string
  description = "Admin IP for firewall access to port 18083 (EMQX admin console)"
}

variable "firebase_project_id" {
  type        = string
  description = "Firebase Project ID (usually same as gcp_project_id)"
}

variable "hosting_domain" {
  type        = string
  description = "Firebase Hosting domain"
}

variable "vm_machine_type" {
  type        = string
  default     = "e2-small"
  description = "GCE machine type"
}

variable "vm_image" {
  type        = string
  default     = "debian-12-amd64"
  description = "GCE image family"
}

variable "emqx_version" {
  type        = string
  default     = "5.8"
  description = "EMQX version"
}

variable "api_base_url" {
  type        = string
  description = "API base URL for hub credential"
}

variable "vm_network" {
  type        = string
  default     = "default"
  description = "VPC network name"
}
