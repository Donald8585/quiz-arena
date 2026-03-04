terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.5.0"
}

provider "aws" {
  region = var.aws_region
}

data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
data "aws_availability_zones" "available" { state = "available" }

# ==================== SECURITY GROUPS ====================

resource "aws_security_group" "ec2_sg" {
  name        = "quiz-arena-ec2-sg"
  description = "EC2 ports"
  vpc_id      = data.aws_vpc.default.id

  # SSH - open to all for EC2 Instance Connect compatibility
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH (open for EC2 Instance Connect)"
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Nginx"
  }
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Frontend"
  }
  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Grafana"
  }
  ingress {
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
    description = "Prometheus"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "quiz-arena-ec2-sg" }
}

resource "aws_security_group" "rds_sg" {
  name        = "quiz-arena-rds-sg"
  description = "RDS PostgreSQL"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
    description     = "PostgreSQL from EC2"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "quiz-arena-rds-sg" }
}

resource "aws_security_group" "redis_sg" {
  name        = "quiz-arena-redis-sg"
  description = "ElastiCache Redis"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
    description     = "Redis from EC2"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "quiz-arena-redis-sg" }
}

# ==================== RDS (Free Tier) ====================

resource "aws_db_instance" "postgres" {
  identifier             = "quiz-arena-db"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_type           = "gp2"
  db_name                = "quizdb"
  username               = var.db_username
  password               = var.db_password
  skip_final_snapshot    = true
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  tags = { Name = "quiz-arena-db" }
}

# ==================== ElastiCache Redis (Free Tier) ====================

resource "aws_elasticache_subnet_group" "redis_subnet" {
  name       = "quiz-arena-redis-subnet"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id         = "quiz-arena-redis"
  engine             = "redis"
  node_type          = "cache.t3.micro"
  num_cache_nodes    = 1
  port               = 6379
  security_group_ids = [aws_security_group.redis_sg.id]
  subnet_group_name  = aws_elasticache_subnet_group.redis_subnet.name

  tags = { Name = "quiz-arena-redis" }
}

# ==================== EC2 (Free Tier) ====================

resource "aws_instance" "quiz_arena" {
  ami                    = var.ami_id
  instance_type          = "t2.micro"
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  subnet_id              = data.aws_subnets.default.ids[0]

  root_block_device {
    volume_size = 30
    volume_type = "gp2"
  }

  user_data = <<-USERDATA
    #!/bin/bash
    set -e
    exec > /var/log/quiz-arena-deploy.log 2>&1

    echo "=== [1/7] System update ==="
    sudo yum update -y
    sudo yum install -y docker git

    echo "=== [2/7] Docker setup ==="
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user

    echo "=== [3/7] Docker Compose v2 ==="
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL -L "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)"       -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    echo "=== [4/7] Docker Buildx ==="
    BUILDX_URL=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep "browser_download_url.*linux-amd64\"" | cut -d '"' -f 4)
    sudo curl -SL -L "$BUILDX_URL"       -o /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

    echo "=== [5/7] Enable 2GB swap (critical for t2.micro) ==="
    sudo dd if=/dev/zero of=/swapfile bs=128M count=16
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab

    echo "=== [6/7] Clone repo and write .env ==="
    cd /home/ec2-user
    git clone https://github.com/${var.github_repo}.git quiz-arena
    cd quiz-arena

    cat > .env << 'ENVEOF'
    DATABASE_URL=postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/quizdb
    REDIS_URL=redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379
    ENVEOF

    echo "=== [7/7] Build & deploy (step-by-step to avoid OOM) ==="
    # Pull pre-built images first
    sudo docker compose pull nginx prometheus grafana

    # Build custom images one at a time to avoid OOM
    sudo docker compose build backend1
    sudo docker compose build backend2
    sudo docker compose build lambda-mock
    sudo docker compose build frontend

    # Start all containers
    sudo docker compose up -d

    echo "Quiz Arena FREE TIER deployed at $(date)" > /home/ec2-user/deploy.log
    sudo chown -R ec2-user:ec2-user /home/ec2-user/quiz-arena
  USERDATA

  depends_on = [aws_db_instance.postgres, aws_elasticache_cluster.redis]
  tags       = { Name = "quiz-arena-server" }
}

resource "aws_eip" "quiz_arena_eip" {
  instance = aws_instance.quiz_arena.id
  domain   = "vpc"
  tags     = { Name = "quiz-arena-eip" }
}
