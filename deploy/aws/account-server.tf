###############################################################################
# Windy Pro — account-server on AWS (scaffolding, not yet applied)
#
# This file stands up the identity hub on AWS:
#   - VPC (2 AZ, public + private subnets, NAT for ECS egress)
#   - ACM cert on api.windyword.ai (DNS-validated)
#   - Route 53 records for api.windyword.ai → ALB
#   - ALB (HTTPS) → ECS Fargate service running the account-server image
#   - RDS Postgres (production DATABASE_URL)
#   - ElastiCache Redis (production REDIS_URL — token blacklist, rate limits)
#   - Secrets Manager for JWT, MFA key, Resend API key, and the 5 per-consumer
#     webhook secrets (PR4 fan-out)
#   - CloudWatch log group for the ECS task
#
# IMPORTANT: This is a scaffold — review every resource before apply. Known
# choices that may want tuning:
#   - Fargate sized at 512 CPU / 1 GB (cheap; bump for prod load)
#   - RDS db.t4g.micro single-AZ (cheap; switch to Multi-AZ for HA)
#   - Redis cache.t4g.micro single-node (cheap; cluster for HA)
#   - HTTPS-only on ALB (HTTP redirects to HTTPS)
#   - ECS tasks run in private subnets with NAT egress (no public IPs)
#
# Apply steps: see deploy/aws/README.md.
###############################################################################

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Uncomment and configure before first apply — don't keep state local in prod.
  # backend "s3" {
  #   bucket         = "windy-terraform-state"
  #   key            = "account-server/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "windy-terraform-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "windy-pro"
      Service     = "account-server"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (prod/staging). Drives resource naming."
  type        = string
  default     = "prod"
}

variable "apex_domain" {
  description = "Apex domain hosted in Route 53."
  type        = string
  default     = "windyword.ai"
}

variable "api_subdomain" {
  description = "Subdomain for the account-server API (full FQDN will be api.<apex>)."
  type        = string
  default     = "api"
}

variable "container_image" {
  description = <<-EOT
    Fully-qualified container image, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/windy-account-server:v2.0.0
    Push it with the Dockerfile in account-server/ before apply.
  EOT
  type = string
}

variable "task_cpu" {
  description = "Fargate vCPU units (256, 512, 1024, ...)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate memory (MiB)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks to run."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS Postgres instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS storage in GiB."
  type        = number
  default     = 20
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.micro"
}

locals {
  name_prefix = "windy-${var.environment}-account-server"
  api_fqdn    = "${var.api_subdomain}.${var.apex_domain}"
}

# ─── Data sources ─────────────────────────────────────────────────────────────

data "aws_availability_zones" "available" { state = "available" }

data "aws_route53_zone" "apex" {
  name         = var.apex_domain
  private_zone = false
}

# ─── VPC + subnets ────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.60.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name_prefix}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${local.name_prefix}-private-${count.index}" }
}

resource "aws_eip" "nat" {
  count  = 1
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  count         = 1
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${local.name_prefix}-nat" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[0].id
  }
  tags = { Name = "${local.name_prefix}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ─── Security groups ──────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Public HTTPS to ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from the internet"
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (redirects to HTTPS)"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs-sg"
  description = "ALB → ECS tasks on port 8098"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 8098
    to_port         = 8098
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "ALB to tasks"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "ECS tasks → Postgres 5432"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "Postgres from ECS"
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis-sg"
  description = "ECS tasks → Redis 6379"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "Redis from ECS"
  }
}

# ─── TLS cert (ACM) ───────────────────────────────────────────────────────────

resource "aws_acm_certificate" "api" {
  domain_name       = local.api_fqdn
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.apex.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

# ─── ALB ──────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 60
}

resource "aws_lb_target_group" "account_server" {
  name        = "${local.name_prefix}-tg"
  port        = 8098
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.account_server.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.apex.zone_id
  name    = local.api_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# ─── RDS Postgres ─────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier             = "${local.name_prefix}-db"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage_gb
  storage_encrypted      = true
  db_name                = "windypro"
  username               = "windy"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot    = var.environment != "prod"
  deletion_protection    = var.environment == "prod"
  backup_retention_period = var.environment == "prod" ? 7 : 1
  multi_az               = var.environment == "prod"
  apply_immediately      = var.environment != "prod"
}

# ─── ElastiCache Redis ────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
}

# ─── Secrets Manager ──────────────────────────────────────────────────────────

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "mfa_encryption_key" {
  # 32 hex chars would be 16 bytes; we want 32 BYTES = 64 hex chars.
  length  = 64
  special = false
  upper   = false
  numeric = true
}

resource "random_password" "webhook_secret" {
  for_each = toset(["mail", "chat", "cloud", "clone", "eternitas"])
  length   = 64
  special  = false
  upper    = false
  numeric  = true
}

# P0-4: RSA keypair for RS256 JWT signing. Without this, /well-known/jwks.json
# returns empty and every ecosystem consumer that verifies via JWKS rejects
# our tokens. We generate the key IN Terraform and ship it via Secrets
# Manager as JWT_PRIVATE_KEY (the inline-PEM env var strategy added to
# src/jwks.ts). PEM lives only in state + Secrets Manager, never on the ECS
# host filesystem.
#
# Rotating: bump the `rotation` count to force Terraform to regenerate.
# The account-server's JWKS cache will include the new kid after task
# restart; tokens signed with the old key still verify until they expire.
resource "tls_private_key" "jwt" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

locals {
  # All runtime secrets for the account-server. Stored as a single JSON
  # document in Secrets Manager — ECS pulls individual keys via `valueFrom`
  # secret-arn-with-key syntax.
  runtime_secrets = merge({
    DATABASE_URL       = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
    REDIS_URL          = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
    JWT_SECRET         = random_password.jwt_secret.result
    MFA_ENCRYPTION_KEY = random_password.mfa_encryption_key.result
    # Inline PEM — src/jwks.ts strategy 0 parses this (standard PEM with
    # newlines OR "\n"-escaped single-line). Ships as a Secrets Manager
    # JSON key so ECS can pull it via the same mechanism as the other
    # secrets, no extra IAM or volume mount required.
    JWT_PRIVATE_KEY    = tls_private_key.jwt.private_key_pem
    }, {
    for name, pw in random_password.webhook_secret :
    (name == "eternitas" ? "ETERNITAS_WEBHOOK_SECRET" : "WINDY_${upper(name)}_WEBHOOK_SECRET") => pw.result
  })
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name_prefix}/runtime"
  description             = "Runtime secrets for windy-pro account-server"
  recovery_window_in_days = var.environment == "prod" ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id     = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode(local.runtime_secrets)
}

# ─── IAM for ECS ──────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-task-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets_read" {
  name = "${local.name_prefix}-secrets-read"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.runtime.arn]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ─── ECS cluster + service ────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "account_server" {
  family                   = local.name_prefix
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = "account-server"
    image        = var.container_image
    essential    = true
    portMappings = [{ containerPort = 8098, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV",             value = "production" },
      { name = "PORT",                 value = "8098" },
      { name = "OIDC_ISSUER",          value = "https://${local.api_fqdn}" },
      # P0-1: rate limits per-IP require trust proxy behind ALB.
      { name = "TRUST_PROXY",          value = "1" },
      # P0-7: without this server refuses to boot.
      { name = "CORS_ALLOWED_ORIGINS", value = "https://${var.apex_domain},https://${local.api_fqdn}" },
    ]
    secrets = [
      for k in keys(local.runtime_secrets) :
      { name = k, valueFrom = "${aws_secretsmanager_secret.runtime.arn}:${k}::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.ecs.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:8098/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
  }])
}

resource "aws_ecs_service" "account_server" {
  name            = "${local.name_prefix}-svc"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.account_server.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.account_server.arn
    container_name   = "account-server"
    container_port   = 8098
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.https]
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "api_url" {
  value       = "https://${local.api_fqdn}"
  description = "Public URL of the account-server."
}

output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "ALB DNS name (for sanity checks; prod traffic goes via api_url)."
}

output "db_endpoint" {
  value       = aws_db_instance.main.endpoint
  description = "RDS Postgres endpoint (private)."
  sensitive   = true
}

output "redis_endpoint" {
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
  description = "ElastiCache Redis endpoint (private)."
  sensitive   = true
}

output "runtime_secrets_arn" {
  value       = aws_secretsmanager_secret.runtime.arn
  description = "Secrets Manager ARN holding JSON of runtime secrets."
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.account_server.name
}
