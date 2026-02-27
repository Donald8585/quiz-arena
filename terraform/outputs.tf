output "public_ip" {
  value = aws_eip.quiz_arena_eip.public_ip
}
output "frontend_url" {
  value = "http://${aws_eip.quiz_arena_eip.public_ip}:3000"
}
output "api_url" {
  value = "http://${aws_eip.quiz_arena_eip.public_ip}:80"
}
output "grafana_url" {
  value = "http://${aws_eip.quiz_arena_eip.public_ip}:3001"
}
output "ssh_command" {
  value = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.quiz_arena_eip.public_ip}"
}
output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}
output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}
