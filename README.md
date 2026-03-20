# 🎮 Quiz Arena

**Real-Time Multiplayer Quiz Platform with Distributed Cloud Architecture**

> Players join rooms, vote on a quiz topic, race through timed questions, and watch scores update live on a WebSocket-powered leaderboard — all running across two EC2 instances, nine Docker containers, and fully automated with Terraform.

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Terraform](https://img.shields.io/badge/Terraform-7B42BC?style=flat&logo=terraform&logoColor=white)](https://www.terraform.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![AWS](https://img.shields.io/badge/AWS-FF9900?style=flat&logo=amazonaws&logoColor=white)](https://aws.amazon.com/)

---

## 📖 Table of Contents

- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start — Local Docker](#-quick-start--local-docker)
- [Local Service Addresses](#-local-service-addresses)
- [Deploy to AWS with Terraform](#-deploy-to-aws-with-terraform)
- [Terraform Outputs & Addresses](#-terraform-outputs--addresses)
- [Tear Down](#-tear-down)
- [Project Structure](#-project-structure)
- [Monitoring](#-monitoring)
- [Team](#-team)

---

## 🏗 Architecture

```
Users (Browsers)
        │
        ▼
┌─────────────────────┐
│   Nginx (Port 80)   │
│   Reverse Proxy / LB│
└────────┬────────────┘
         │  round-robin
    ┌────┴─────┐
    ▼          ▼
┌────────┐ ┌────────┐
│Backend1│ │Backend2│    ← FastAPI + WebSocket
│  (App) │ │(Worker)│
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌──────────────────┐     ┌──────────────────┐
│ Redis ElastiCache│     │ RDS PostgreSQL   │
│ Pub/Sub + State  │     │ Users & Results  │
└──────────────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│   AWS Lambda     │     │ Prometheus +     │
│ Question Gen     │     │ Grafana          │
└──────────────────┘     └──────────────────┘
```

**Two EC2 instances, nine containers:**

| Server | Containers |
|--------|-----------|
| **App Server** (EC2 #1) | Nginx, Backend 1, Frontend (Next.js), Node Exporter |
| **Worker Server** (EC2 #2) | Backend 2, Prometheus, Grafana, Node Exporter |

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js | SSR out of the box, no webpack config pain |
| Backend | FastAPI | Native async + built-in WebSocket support |
| Reverse Proxy | Nginx | Path-based routing, round-robin LB, free |
| Cache & Pub/Sub | Redis (ElastiCache) | Cross-server sync via Pub/Sub, room state |
| Database | PostgreSQL (RDS) | Durable storage for users, results, leaderboards |
| Serverless | AWS Lambda | Quiz question generation with 3-tier fallback |
| Monitoring | Prometheus + Grafana | Metrics scraping, dashboards, alerting |
| IaC | Terraform | Single `main.tf` → 19 AWS resources |
| Containers | Docker + Docker Compose | Consistent environments across dev & prod |

---

## 🚀 Quick Start — Local Docker

Run everything on your machine with Docker Compose. This spins up the backend, frontend, Redis, and PostgreSQL locally — no AWS needed.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) v2+
- Git

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/Donald8585/quiz-arena.git
cd quiz-arena

# 2. Create a local .env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://quizuser:quizpass@postgres:5432/quizdb
REDIS_URL=redis://redis:6379
LAMBDA_URL=
INSTANCE_ID=local-dev
SERVER_ROLE=local
EOF

# 3. Start all services
docker compose up -d --build

# 4. Wait ~30 seconds for builds, then open:
#    Frontend:  http://localhost:3000
#    Backend:   http://localhost:8000
#    API Docs:  http://localhost:8000/docs
```

### Stop Local

```bash
# Stop and remove containers (keeps volumes/data)
docker compose down

# Stop and remove EVERYTHING (including database data)
docker compose down -v
```

---

## 🌐 Local Service Addresses

After running `docker compose up`, these are your local endpoints:

| Service | URL | Notes |
|---------|-----|-------|
| **Frontend** | [http://localhost:3000](http://localhost:3000) | Next.js app — main game UI |
| **Backend API** | [http://localhost:8000](http://localhost:8000) | FastAPI server |
| **API Docs (Swagger)** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive API documentation |
| **WebSocket** | `ws://localhost:8000/ws/{room_code}` | Real-time game connection |
| **Health Check** | [http://localhost:8000/health](http://localhost:8000/health) | Backend health status |
| **Metrics** | [http://localhost:8000/metrics](http://localhost:8000/metrics) | Prometheus metrics endpoint |
| **PostgreSQL** | `localhost:5432` | User: `quizuser` / Pass: `quizpass` / DB: `quizdb` |
| **Redis** | `localhost:6379` | No auth locally |

> **Note:** Lambda question generation won't work locally (no AWS). The backend automatically falls back to the hardcoded question bank (40 questions across 4 topics).

---

## ☁️ Deploy to AWS with Terraform

Full cloud deployment: 2 EC2 instances, RDS, ElastiCache, Lambda, the works. Everything from zero in ~7 minutes.

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/downloads) ≥ 1.5
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured (`aws configure`)
- An AWS key pair (for SSH access to EC2 instances)

### Steps

```bash
# 1. Navigate to the Terraform directory
cd terraform

# 2. Copy the example tfvars and fill in your values
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your details:

```hcl
aws_region  = "us-east-1"
key_name    = "your-key-pair-name"    # AWS key pair for SSH
my_ip       = "YOUR.IP.HERE/32"       # Your IP for security groups
github_repo = "Donald8585/quiz-arena"
db_username = "quizuser"
db_password = "YourSecurePassword123!"
```

> **Tip:** Find your public IP with `curl ifconfig.me`, then append `/32`.

```bash
# 3. Initialize Terraform (downloads providers)
terraform init

# 4. Preview what will be created (optional but recommended)
terraform plan

# 5. Deploy everything 🚀
terraform apply
```

Type `yes` when prompted. Grab a coffee — RDS takes ~5 minutes to spin up.

```bash
# 6. After apply completes, view your endpoints:
terraform output
```

### What Gets Created (19 Resources)

- 🖥️ 2× EC2 instances (t2.micro) with Elastic IPs
- 🐘 1× RDS PostgreSQL instance (db.t3.micro)
- 🔴 1× ElastiCache Redis cluster (cache.t3.micro)
- ⚡ 1× Lambda function + Function URL
- 🔒 3× Security Groups (EC2, RDS, Redis)
- 🌐 2× Network Interfaces + 2× Elastic IPs
- 🔑 IAM roles and instance profiles

---

## 📋 Terraform Outputs & Addresses

After `terraform apply`, you'll see these outputs:

| Output | What it is |
|--------|-----------|
| `frontend_url` | `http://<app-server-ip>` — The game! |
| `api_url` | `http://<app-server-ip>/api` — Backend API |
| `grafana_url` | `http://<worker-ip>:3001` — Grafana dashboards (admin/admin) |
| `prometheus_url` | `http://<worker-ip>:9090` — Prometheus UI |
| `rds_endpoint` | RDS PostgreSQL connection string |
| `redis_endpoint` | ElastiCache Redis address |
| `lambda_url` | Lambda Function URL for question generation |
| `ssh_app_server` | SSH command for app server |
| `ssh_worker_server` | SSH command for worker server |

Quick access after deploy:

```bash
# Open the game
open $(terraform output -raw frontend_url)

# Open Grafana dashboards
open $(terraform output -raw grafana_url)

# SSH into app server (debugging)
$(terraform output -raw ssh_app_server)

# SSH into worker server (debugging)
$(terraform output -raw ssh_worker_server)
```

---

## 💣 Tear Down

Destroy all AWS resources when you're done. **This deletes everything** — EC2 instances, database, cache, Lambda, the lot.

```bash
cd terraform

# Preview what will be destroyed (optional)
terraform plan -destroy

# Destroy everything
terraform destroy
```

Type `yes` when prompted. Takes ~3–5 minutes (RDS deletion is the slowest part).

> **Pro tip:** You can rebuild from scratch anytime with `terraform apply`. Full cycle (destroy → apply) takes ~10–12 minutes total. We did this many, many times during development. 😅

---

## 📁 Project Structure

```
quiz-arena/
├── backend/              # FastAPI application
│   ├── main.py           # API routes, WebSocket handlers, game logic
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/             # Next.js application
│   ├── app/
│   │   └── page.js       # Main game UI
│   ├── Dockerfile
│   └── package.json
├── lambda-function/      # AWS Lambda question generator
│   └── handler.py
├── terraform/            # Infrastructure as Code
│   ├── main.tf           # All 19 AWS resources
│   ├── variables.tf      # Input variables
│   ├── outputs.tf        # Endpoint outputs
│   ├── terraform.tfvars.example
│   ├── user_data_app.sh.tpl      # App server bootstrap script
│   └── user_data_worker.sh.tpl   # Worker server bootstrap script
├── monitoring/           # Prometheus config
│   └── prometheus.yml
├── nginx/                # Nginx reverse proxy config
│   └── nginx.conf
├── docker-compose.yml            # Local development
├── docker-compose.server1.yml    # App server (generated by user_data)
├── docker-compose.server2.yml    # Worker server (generated by user_data)
└── README.md
```

---

## 📊 Monitoring

Once deployed, the monitoring stack is available on the **worker server**:

- **Grafana:** `http://<worker-ip>:3001` (default login: `admin` / `admin`)
- **Prometheus:** `http://<worker-ip>:9090`

### Metrics Collected

| Metric | Description |
|--------|------------|
| HTTP requests | By method, endpoint, instance, status code |
| WebSocket connections | Total + active, per backend instance |
| Quiz answers | Correct vs. incorrect counts |
| Lambda calls | Success/failure rates |
| Request latency | Histogram distribution |
| Host CPU/Memory | Via Node Exporter on both servers |

Prometheus scrapes **5 targets** every 15 seconds: Backend 1, Backend 2, Nginx, and both Node Exporters.

---

## 👥 Team

**Group 2 — COM6102 Distributed Systems and Cloud Computing, Spring 2026**

| Member | Student ID |
|--------|-----------|
| FU Wangxi | P253212 |
| KONG Yibo | P253223 |
| SO Chit Wai | P253494 |
| WANG Fei | P253240 |

---

<p align="center">
  Built with ☕ and <code>terraform destroy && terraform apply</code> on repeat.
</p>
