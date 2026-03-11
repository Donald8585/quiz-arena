#!/bin/bash
exec > /var/log/quiz-arena-deploy.log 2>&1
set -ex

dnf update -y
dnf install -y docker git
systemctl enable docker && systemctl start docker

mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

BUILDX_URL="https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64"
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL "$BUILDX_URL" -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx

usermod -aG docker ec2-user

cd /home/ec2-user
sudo -u ec2-user git clone ${github_repo} quiz-arena || true
cd quiz-arena

cat > .env << ENVEOF
DATABASE_URL=postgresql://quizuser:QuizArena2026!@${db_endpoint}/quizdb
REDIS_URL=redis://${redis_endpoint}:6379
LAMBDA_URL=${lambda_url}
APP_BACKEND_URL=http://${app_private_ip}:8000
ENVEOF

cat > docker-compose.server2.yml << 'DCEOF'
services:
  backend2:
    build: ./backend
    env_file: .env
    environment:
      - INSTANCE_ID=backend2
      - SERVER_ROLE=worker-server
    ports: ["8000:8000"]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 128m

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports: ["9090:9090"]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 128m

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SERVER_HTTP_PORT=3001
    ports: ["3001:3001"]
    depends_on: [prometheus]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 128m

  node-exporter:
    image: prom/node-exporter:latest
    ports: ["9100:9100"]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 32m

networks:
  quiznet:
    driver: bridge
DCEOF

mkdir -p monitoring
cat > monitoring/prometheus.yml << PROMEOF
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "backend1"
    metrics_path: /metrics
    static_configs:
      - targets: ["${app_private_ip}:8000"]
        labels:
          instance: "backend1"

  - job_name: "backend2"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:8000"]
        labels:
          instance: "backend2"

  - job_name: "nginx"
    metrics_path: /metrics
    static_configs:
      - targets: ["${app_private_ip}:80"]

  - job_name: "node-app"
    static_configs:
      - targets: ["${app_private_ip}:9100"]

  - job_name: "node-worker"
    static_configs:
      - targets: ["node-exporter:9100"]
PROMEOF

docker compose -f docker-compose.server2.yml up -d --build

echo "=== WORKER SERVER DEPLOY COMPLETE ==="
