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

# ==================== IAM ====================

resource "aws_iam_role" "lambda_role" {
  name = "quiz-arena-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role" "ec2_role" {
  name = "quiz-arena-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ec2_lambda_invoke" {
  name = "lambda-invoke"
  role = aws_iam_role.ec2_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction", "lambda:InvokeFunctionUrl"]
      Resource = aws_lambda_function.quiz_questions.arn
    }]
  })
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "quiz-arena-ec2-profile"
  role = aws_iam_role.ec2_role.name
}

# ==================== SECURITY GROUPS ====================

resource "aws_security_group" "ec2_sg" {
  name        = "quiz-arena-ec2-sg"
  description = "EC2 ports for Quiz Arena"
  vpc_id      = data.aws_vpc.default.id

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
    description = "Nginx reverse proxy"
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
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    self        = true
    description = "Backend cross-server communication"
  }
  ingress {
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Prometheus"
  }
  ingress {
    from_port   = 9100
    to_port     = 9100
    protocol    = "tcp"
    self        = true
    description = "Node exporter metrics"
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

# ==================== LAMBDA (Serverless) ====================

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda-function"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "quiz_questions" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "quiz-arena-questions"
  role             = aws_iam_role.lambda_role.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  tags = { Name = "quiz-arena-lambda" }
}

resource "aws_lambda_function_url" "quiz_questions_url" {
  function_name      = aws_lambda_function.quiz_questions.function_name
  authorization_type = "NONE"
}

# ==================== EC2 #1 — App Server ====================

resource "aws_instance" "app_server" {
  ami                    = var.ami_id
  instance_type          = "t2.micro"
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  subnet_id              = data.aws_subnets.default.ids[0]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  root_block_device {
    volume_size = 30
    volume_type = "gp2"
  }

  user_data = <<-USERDATA
    #!/bin/bash
    set -e
    exec > /var/log/quiz-arena-deploy.log 2>&1

    echo "=== [1/8] System update ==="
    sudo yum update -y
    sudo yum install -y docker git

    echo "=== [2/8] Docker setup ==="
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user

    echo "=== [3/8] Docker Compose v2 ==="
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL -L "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    echo "=== [4/8] Docker Buildx ==="
    BUILDX_URL=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep "browser_download_url.*linux-amd64\"" | cut -d '"' -f 4)
    sudo curl -SL -L "$BUILDX_URL" \
      -o /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

    echo "=== [5/8] Enable 2GB swap ==="
    sudo dd if=/dev/zero of=/swapfile bs=128M count=16
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab

    echo "=== [6/8] Clone repo ==="
    cd /home/ec2-user
    git clone https://github.com/${var.github_repo}.git quiz-arena
    cd quiz-arena

    echo "=== [7/8] Write .env and nginx.conf ==="
    cat > .env << ENVEOF
    DATABASE_URL=postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/quizdb
    REDIS_URL=redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379
    LAMBDA_URL=${aws_lambda_function_url.quiz_questions_url.function_url}
    ENVEOF

    mkdir -p nginx
    cat > nginx/nginx.conf << 'NGINXCONF'
    events { worker_connections 1024; }
    http {
        upstream backend_api {
            server backend1:8000;
            server ${aws_instance.worker_server.private_ip}:8000;
        }
        upstream backend_ws {
            ip_hash;
            server backend1:8000;
            server ${aws_instance.worker_server.private_ip}:8000;
        }
        map $http_upgrade $connection_upgrade {
            default upgrade;
            '' close;
        }
        server {
            listen 80;
            location /api/ {
                proxy_pass http://backend_api;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            }
            location /health { proxy_pass http://backend_api; }
            location /metrics { proxy_pass http://backend_api; }
            location /ws/ {
                proxy_pass http://backend_ws;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection $connection_upgrade;
                proxy_set_header Host $host;
                proxy_read_timeout 86400;
                proxy_send_timeout 86400;
            }
        }
    }
    NGINXCONF

    echo "=== [8/8] Build & deploy (step-by-step) ==="
    sudo docker compose -f docker-compose.server1.yml pull nginx
    sudo docker compose -f docker-compose.server1.yml build backend1
    sudo docker compose -f docker-compose.server1.yml build frontend
    sudo docker compose -f docker-compose.server1.yml up -d

    sudo chown -R ec2-user:ec2-user /home/ec2-user/quiz-arena
    echo "App Server deployed at $(date)" > /home/ec2-user/deploy.log
  USERDATA

  depends_on = [aws_db_instance.postgres, aws_elasticache_cluster.redis, aws_instance.worker_server]
  tags       = { Name = "quiz-arena-app-server" }
}

# ==================== EC2 #2 — Worker Server ====================

resource "aws_instance" "worker_server" {
  ami                    = var.ami_id
  instance_type          = "t2.micro"
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  subnet_id              = data.aws_subnets.default.ids[1]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  root_block_device {
    volume_size = 30
    volume_type = "gp2"
  }

  user_data = <<-USERDATA
    #!/bin/bash
    set -e
    exec > /var/log/quiz-arena-deploy.log 2>&1

    echo "=== [1/8] System update ==="
    sudo yum update -y
    sudo yum install -y docker git

    echo "=== [2/8] Docker setup ==="
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user

    echo "=== [3/8] Docker Compose v2 ==="
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL -L "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    echo "=== [4/8] Docker Buildx ==="
    BUILDX_URL=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep "browser_download_url.*linux-amd64\"" | cut -d '"' -f 4)
    sudo curl -SL -L "$BUILDX_URL" \
      -o /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

    echo "=== [5/8] Enable 2GB swap ==="
    sudo dd if=/dev/zero of=/swapfile bs=128M count=16
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab

    echo "=== [6/8] Clone repo ==="
    cd /home/ec2-user
    git clone https://github.com/${var.github_repo}.git quiz-arena
    cd quiz-arena

    echo "=== [7/8] Write .env and prometheus config ==="
    cat > .env << ENVEOF
    DATABASE_URL=postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/quizdb
    REDIS_URL=redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379
    LAMBDA_URL=${aws_lambda_function_url.quiz_questions_url.function_url}
    ENVEOF

    mkdir -p prometheus
    cat > prometheus/prometheus.yml << 'PROMEOF'
    global:
      scrape_interval: 15s
    scrape_configs:
      - job_name: 'backend2-local'
        static_configs:
          - targets: ['backend2:8000']
      - job_name: 'nginx-remote'
        static_configs:
          - targets: ['${aws_instance.app_server.private_ip}:80']
    PROMEOF

    echo "=== [8/8] Build & deploy (step-by-step) ==="
    sudo docker compose -f docker-compose.server2.yml pull prometheus grafana
    sudo docker compose -f docker-compose.server2.yml build backend2
    sudo docker compose -f docker-compose.server2.yml up -d

    sudo chown -R ec2-user:ec2-user /home/ec2-user/quiz-arena
    echo "Worker Server deployed at $(date)" > /home/ec2-user/deploy.log
  USERDATA

  depends_on = [aws_db_instance.postgres, aws_elasticache_cluster.redis]
  tags       = { Name = "quiz-arena-worker-server" }
}

# ==================== Elastic IPs ====================

resource "aws_eip" "app_eip" {
  instance = aws_instance.app_server.id
  domain   = "vpc"
  tags     = { Name = "quiz-arena-app-eip" }
}

resource "aws_eip" "worker_eip" {
  instance = aws_instance.worker_server.id
  domain   = "vpc"
  tags     = { Name = "quiz-arena-worker-eip" }
}
