# Quiz Arena
Real-time multiplayer quiz platform on AWS Free Tier

## Local Dev (12 containers)
```bash
docker-compose -f docker-compose.local.yml up --build -d
```

## AWS Free Tier (7 containers + RDS + ElastiCache)
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init && terraform apply
```

| Service | URL |
|---|---|
| Frontend | http://IP:3000 |
| API | http://IP:80/health |
| Grafana | http://IP:3001 |
