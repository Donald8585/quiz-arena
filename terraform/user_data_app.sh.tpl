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
WORKER_BACKEND_URL=http://${worker_private_ip}:8000
ENVEOF

mkdir -p nginx
cat > nginx/nginx.conf << 'NGINXEOF'
events { worker_connections 1024; }

http {
    resolver 127.0.0.11 valid=10s ipv6=off;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    upstream backends {
        server backend1:8000;
        server WORKER_IP_PLACEHOLDER:8000;
    }

    server {
        listen 80;
        server_name _;

        location / {
            set $frontend http://frontend:3000;
            proxy_pass $frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /api/ {
            proxy_pass http://backends;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /health {
            proxy_pass http://backends;
            proxy_set_header Host $host;
        }

        location /metrics {
            set $backend http://backend1:8000;
            proxy_pass $backend;
        }

        location /ws/ {
            proxy_pass http://backends;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }
    }
}
NGINXEOF

sed -i "s/WORKER_IP_PLACEHOLDER/${worker_private_ip}/" nginx/nginx.conf

cat > docker-compose.server1.yml << 'DCEOF'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on: [backend1]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 32m

  backend1:
    build: ./backend
    env_file: .env
    environment:
      - INSTANCE_ID=backend1
      - SERVER_ROLE=app-server
    ports: ["8000:8000"]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 128m

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend1]
    networks: [quiznet]
    restart: unless-stopped
    mem_limit: 256m

networks:
  quiznet:
    driver: bridge
DCEOF

docker compose -f docker-compose.server1.yml up -d --build

echo "=== APP SERVER DEPLOY COMPLETE ==="
