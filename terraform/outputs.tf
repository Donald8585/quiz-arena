output "app_server_public_ip" {
  value = aws_eip.app_eip.public_ip
}
output "worker_server_public_ip" {
  value = aws_eip.worker_eip.public_ip
}
output "frontend_url" {
  value = "http://${aws_eip.app_eip.public_ip}:3000"
}
output "api_url" {
  value = "http://${aws_eip.app_eip.public_ip}:80"
}
output "grafana_url" {
  value = "http://${aws_eip.worker_eip.public_ip}:3001"
}
output "prometheus_url" {
  value = "http://${aws_eip.worker_eip.public_ip}:9090"
}
output "lambda_url" {
  value = aws_lambda_function_url.quiz_questions_url.function_url
}
output "ssh_app_server" {
  value = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.app_eip.public_ip}"
}
output "ssh_worker_server" {
  value = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.worker_eip.public_ip}"
}
output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}
output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}
