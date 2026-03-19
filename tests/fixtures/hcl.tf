resource "aws_s3_bucket" "logs" {
  bucket = "my-logs-bucket"
  acl    = "private"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

output "bucket_arn" {
  value = aws_s3_bucket.logs.arn
}

locals {
  environment = "production"
  project     = "demo"
}

data "aws_caller_identity" "current" {}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "3.0.0"
}
