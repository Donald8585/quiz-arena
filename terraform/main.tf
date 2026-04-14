terraform {
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.0" }
  }
}

provider "aws" { region = "us-east-1" }

data "aws_vpc" "default" { default = true }
data "aws_availability_zones" "available" { state = "available" }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda-function"
  output_path = "${path.module}/lambda.zip"
}

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

resource "aws_lambda_function" "quiz_questions" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "quiz-arena-questions"
  role             = aws_iam_role.lambda_role.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  tags             = { Name = "quiz-arena-lambda" }
}

resource "aws_lambda_function_url" "quiz_questions_url" {
  function_name      = aws_lambda_function.quiz_questions.function_name
  authorization_type = "NONE"
}

resource "aws_security_group" "ec2_sg" {
  name        = "quiz-arena-ec2-sg"
  description = "EC2 ports for Quiz Arena"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Frontend"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Grafana"
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Prometheus"
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Backend cross-server"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    self        = true
  }

  ingress {
    description = "Node exporter metrics"
    from_port   = 9100
    to_port     = 9100
    protocol    = "tcp"
    self        = true
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
    description     = "PostgreSQL from EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
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
    description     = "Redis from EC2"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "quiz-arena-redis-sg" }
}

resource "aws_db_instance" "postgres" {
  identifier             = "quiz-arena-db"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_type           = "gp2"
  db_name                = "quizdb"
  username               = "quizuser"
  password               = "QuizArena2026!"
  publicly_accessible    = false
  skip_final_snapshot    = true
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  tags                   = { Name = "quiz-arena-db" }
}

resource "aws_elasticache_subnet_group" "redis_subnet" {
  name       = "quiz-arena-redis-subnet"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id         = "quiz-arena-redis"
  engine             = "redis"
  node_type          = "cache.t3.micro"
  num_cache_nodes    = 1
  subnet_group_name  = aws_elasticache_subnet_group.redis_subnet.name
  security_group_ids = [aws_security_group.redis_sg.id]
  port               = 6379
  tags               = { Name = "quiz-arena-redis" }
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

resource "aws_network_interface" "app_eni" {
  subnet_id       = data.aws_subnets.default.ids[0]
  security_groups = [aws_security_group.ec2_sg.id]
  tags            = { Name = "quiz-arena-app-eni" }
}

resource "aws_network_interface" "worker_eni" {
  subnet_id       = data.aws_subnets.default.ids[1]
  security_groups = [aws_security_group.ec2_sg.id]
  tags            = { Name = "quiz-arena-worker-eni" }
}

resource "aws_instance" "app_server" {
  ami                  = "ami-0f3caa1cf4417e51b"
  instance_type        = "t2.micro"
  key_name             = "quiz-arena-key"
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name

  network_interface {
    device_index         = 0
    network_interface_id = aws_network_interface.app_eni.id
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp2"
  }

  user_data = templatefile("${path.module}/user_data_app.sh.tpl", {
    db_endpoint       = aws_db_instance.postgres.endpoint
    redis_endpoint    = aws_elasticache_cluster.redis.cache_nodes[0].address
    lambda_url        = aws_lambda_function_url.quiz_questions_url.function_url
    worker_private_ip = aws_network_interface.worker_eni.private_ip
    github_repo       = "https://github.com/Donald8585/quiz-arena.git"
  })

  tags       = { Name = "quiz-arena-app-server" }
  depends_on = [aws_db_instance.postgres, aws_elasticache_cluster.redis]
}

resource "aws_instance" "worker_server" {
  ami                  = "ami-0f3caa1cf4417e51b"
  instance_type        = "t2.micro"
  key_name             = "quiz-arena-key"
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name

  network_interface {
    device_index         = 0
    network_interface_id = aws_network_interface.worker_eni.id
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp2"
  }

  user_data = templatefile("${path.module}/user_data_worker.sh.tpl", {
    db_endpoint    = aws_db_instance.postgres.endpoint
    redis_endpoint = aws_elasticache_cluster.redis.cache_nodes[0].address
    lambda_url     = aws_lambda_function_url.quiz_questions_url.function_url
    app_private_ip = aws_network_interface.app_eni.private_ip
    github_repo    = "https://github.com/Donald8585/quiz-arena.git"
  })

  tags       = { Name = "quiz-arena-worker-server" }
  depends_on = [aws_db_instance.postgres, aws_elasticache_cluster.redis]
}

resource "aws_eip" "app_eip" {
  network_interface = aws_network_interface.app_eni.id
  domain            = "vpc"
  tags              = { Name = "quiz-arena-app-eip" }
  depends_on        = [aws_instance.app_server]
}

resource "aws_eip" "worker_eip" {
  network_interface = aws_network_interface.worker_eni.id
  domain            = "vpc"
  tags              = { Name = "quiz-arena-worker-eip" }
  depends_on        = [aws_instance.worker_server]
}

# ============================================================
# NO aws_lambda_permission RESOURCES NEEDED!
# aws_lambda_function_url with authorization_type = "NONE"
# auto-creates both FunctionURLAllowPublicAccess and
# FunctionInvokeAllowPublicAccess statements for you.
# ============================================================