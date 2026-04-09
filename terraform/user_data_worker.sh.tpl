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
    volumes:
      - ./monitoring/grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
      - ./monitoring/grafana-dashboards.yml:/etc/grafana/provisioning/dashboards/dashboards.yml:ro
      - ./monitoring/dashboards:/var/lib/grafana/dashboards:ro
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

mkdir -p monitoring/dashboards

# ── Prometheus config (PROPERLY INDENTED YAML) ──
cat > monitoring/prometheus.yml << 'PROMEOF'
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "backend1"
    metrics_path: /metrics
    static_configs:
      - targets: ["APP_IP_PLACEHOLDER:8000"]
        labels:
          instance: "backend1"

  - job_name: "backend2"
    metrics_path: /metrics
    static_configs:
      - targets: ["backend2:8000"]
        labels:
          instance: "backend2"

  - job_name: "node-app"
    static_configs:
      - targets: ["APP_IP_PLACEHOLDER:9100"]

  - job_name: "node-worker"
    static_configs:
      - targets: ["node-exporter:9100"]
PROMEOF

sed -i "s/APP_IP_PLACEHOLDER/${app_private_ip}/g" monitoring/prometheus.yml

# ── Grafana auto-provisioned datasource ──
cat > monitoring/grafana-datasources.yml << 'DSEOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
DSEOF

# ── Grafana dashboard provisioning config ──
cat > monitoring/grafana-dashboards.yml << 'DBEOF'
apiVersion: 1
providers:
  - name: "default"
    orgId: 1
    folder: "Quiz Arena"
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
DBEOF

# ── Pre-built Quiz Arena dashboard ──
cat > monitoring/dashboards/quiz-arena.json << 'JSONEOF'
{
  "annotations": { "list": [] },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "panels": [
    {
      "title": "Backend Instances Up",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
      "targets": [{ "expr": "count(up{job=~\"backend.*\"} == 1)", "legendFormat": "instances" }],
      "fieldConfig": { "defaults": { "thresholds": { "steps": [{"color":"red","value":null},{"color":"green","value":2}] } } },
      "datasource": "Prometheus"
    },
    {
      "title": "Request Rate (per second)",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "targets": [{ "expr": "sum(rate(http_requests_total[1m])) by (instance)", "legendFormat": "{{instance}}" }],
      "datasource": "Prometheus"
    },
    {
      "title": "Request Duration (p95)",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "targets": [{ "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))", "legendFormat": "p95" }],
      "datasource": "Prometheus"
    },
    {
      "title": "CPU Usage %",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 12 },
      "targets": [{ "expr": "100 - (avg by(job) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)", "legendFormat": "{{job}}" }],
      "datasource": "Prometheus"
    },
    {
      "title": "Memory Usage %",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 12 },
      "targets": [{ "expr": "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100", "legendFormat": "{{job}}" }],
      "datasource": "Prometheus"
    },
    {
      "title": "Active WebSocket Connections",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 0 },
      "targets": [{ "expr": "sum(websocket_connections_active)", "legendFormat": "connections" }],
      "datasource": "Prometheus"
    },
    {
      "title": "Active Game Rooms",
      "type": "stat",
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
      "targets": [{ "expr": "sum(game_rooms_active)", "legendFormat": "rooms" }],
      "datasource": "Prometheus"
    },
    {
      "title": "Network I/O (bytes/sec)",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 20 },
      "targets": [
        { "expr": "rate(node_network_receive_bytes_total{device!=\"lo\"}[5m])", "legendFormat": "{{job}} rx" },
        { "expr": "rate(node_network_transmit_bytes_total{device!=\"lo\"}[5m])", "legendFormat": "{{job}} tx" }
      ],
      "datasource": "Prometheus"
    }
  ],
  "schemaVersion": 39,
  "tags": ["quiz-arena"],
  "templating": { "list": [] },
  "time": { "from": "now-1h", "to": "now" },
  "title": "Quiz Arena Overview",
  "uid": "quiz-arena-overview"
}
JSONEOF

docker compose -f docker-compose.server2.yml up -d --build

echo "=== WORKER SERVER DEPLOY COMPLETE ==="
