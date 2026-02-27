variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-east-1"
}

variable "ami_id" {
  description = "Amazon Linux 2023 AMI (check your region!)"
  type        = string
  default     = "ami-0a27d5c93b5a3a4f0"
}

variable "key_name" {
  description = "AWS key pair name for SSH"
  type        = string
}

variable "my_ip" {
  description = "Your IP for SSH access (e.g. 1.2.3.4/32)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo (owner/repo)"
  type        = string
  default     = "Donald8585/quiz-arena"
}

variable "db_username" {
  description = "RDS PostgreSQL username"
  type        = string
  default     = "quizuser"
}

variable "db_password" {
  description = "RDS PostgreSQL password"
  type        = string
  sensitive   = true
}
