import json
from datetime import datetime
import random

QUESTION_BANK = {
    "cloud": [
        {"q": "What does EC2 stand for in AWS?", "options": ["Elastic Compute Cloud", "Electronic Computing Center", "Enterprise Cloud Computing", "Elastic Container Cluster"], "answer": 0},
        {"q": "Which AWS service is a managed NoSQL database?", "options": ["RDS", "DynamoDB", "Redshift", "Aurora"], "answer": 1},
        {"q": "What is the maximum size of an S3 object?", "options": ["1 TB", "5 TB", "10 TB", "Unlimited"], "answer": 1},
        {"q": "Which service provides serverless computing on AWS?", "options": ["EC2", "ECS", "Lambda", "Lightsail"], "answer": 2},
        {"q": "What does VPC stand for?", "options": ["Virtual Public Cloud", "Virtual Private Cloud", "Virtual Protected Computing", "Virtual Private Container"], "answer": 1},
        {"q": "Which AWS service is used for DNS management?", "options": ["CloudFront", "Route 53", "API Gateway", "Direct Connect"], "answer": 1},
        {"q": "What type of storage is Amazon EBS?", "options": ["Object storage", "Block storage", "File storage", "Archive storage"], "answer": 1},
        {"q": "Which service provides a CDN on AWS?", "options": ["S3", "CloudFront", "ElastiCache", "Global Accelerator"], "answer": 1},
        {"q": "What is the default region for AWS services?", "options": ["eu-west-1", "ap-southeast-1", "us-east-1", "us-west-2"], "answer": 2},
        {"q": "Which AWS service provides managed Kubernetes?", "options": ["ECS", "EKS", "Fargate", "Elastic Beanstalk"], "answer": 1},
        {"q": "What is an Availability Zone in AWS?", "options": ["A country", "A data center or group of data centers", "A continent", "A VPC subnet"], "answer": 1},
        {"q": "Which service is used for message queuing on AWS?", "options": ["SNS", "SQS", "Kinesis", "EventBridge"], "answer": 1},
        {"q": "What does IAM stand for?", "options": ["Internet Access Management", "Identity and Access Management", "Integrated Application Manager", "Internal Authentication Module"], "answer": 1},
        {"q": "Which AWS service provides in-memory caching?", "options": ["RDS", "DynamoDB", "ElastiCache", "S3"], "answer": 2},
        {"q": "What is AWS CloudFormation used for?", "options": ["Monitoring", "Infrastructure as Code", "Load balancing", "Data migration"], "answer": 1},
    ],
    "devops": [
        {"q": "What does CI/CD stand for?", "options": ["Continuous Integration/Continuous Deployment", "Code Integration/Code Delivery", "Continuous Inspection/Continuous Development", "Central Integration/Central Delivery"], "answer": 0},
        {"q": "Which tool is commonly used for container orchestration?", "options": ["Jenkins", "Kubernetes", "Ansible", "Terraform"], "answer": 1},
        {"q": "What is the purpose of a Dockerfile?", "options": ["Run tests", "Define container image build steps", "Deploy to production", "Monitor applications"], "answer": 1},
        {"q": "Which command lists running Docker containers?", "options": ["docker images", "docker ps", "docker run", "docker list"], "answer": 1},
        {"q": "What is Terraform primarily used for?", "options": ["CI/CD pipelines", "Infrastructure as Code", "Application monitoring", "Log management"], "answer": 1},
        {"q": "What does 'git rebase' do?", "options": ["Delete a branch", "Reapply commits on top of another base", "Merge two branches", "Reset to initial commit"], "answer": 1},
        {"q": "Which file defines a Docker Compose setup?", "options": ["Dockerfile", "docker-compose.yml", "Makefile", "package.json"], "answer": 1},
        {"q": "What is a rolling deployment?", "options": ["Deploy all at once", "Gradually replace old with new instances", "Deploy to staging only", "Rollback deployment"], "answer": 1},
        {"q": "Which tool is used for secrets management?", "options": ["GitHub Actions", "HashiCorp Vault", "Docker Hub", "Nginx"], "answer": 1},
        {"q": "What does a load balancer do?", "options": ["Store data", "Distribute traffic across servers", "Build containers", "Run CI pipelines"], "answer": 1},
        {"q": "What is blue-green deployment?", "options": ["Running two identical production environments", "Deploying to dev and staging", "Using two CI tools", "A testing strategy"], "answer": 0},
        {"q": "What is the purpose of Prometheus?", "options": ["Container orchestration", "Infrastructure provisioning", "Monitoring and alerting", "Code deployment"], "answer": 2},
        {"q": "Which HTTP status code means 'Service Unavailable'?", "options": ["404", "500", "502", "503"], "answer": 3},
        {"q": "What is GitOps?", "options": ["Git-based project management", "Using Git as single source of truth for infrastructure", "A Git hosting service", "A Git branching strategy"], "answer": 1},
        {"q": "What does a reverse proxy do?", "options": ["Forwards client requests to backend servers", "Caches DNS responses", "Manages SSL certificates", "Blocks all incoming traffic"], "answer": 0},
    ],
    "security": [
        {"q": "What does SSL/TLS provide?", "options": ["Load balancing", "Encryption in transit", "Data compression", "Caching"], "answer": 1},
        {"q": "What is a SQL injection attack?", "options": ["Overloading a server", "Inserting malicious SQL into queries", "Stealing cookies", "DNS spoofing"], "answer": 1},
        {"q": "What does MFA stand for?", "options": ["Multi-Factor Authentication", "Multiple Firewall Access", "Managed File Authorization", "Main Function Allocation"], "answer": 0},
        {"q": "Which port does HTTPS use by default?", "options": ["80", "8080", "443", "22"], "answer": 2},
        {"q": "What is a DDoS attack?", "options": ["Data theft", "Distributed Denial of Service", "DNS hijacking", "Disk corruption"], "answer": 1},
        {"q": "What is the principle of least privilege?", "options": ["Give everyone admin access", "Give minimum permissions needed", "Restrict all access", "Use only root accounts"], "answer": 1},
        {"q": "What does a WAF protect against?", "options": ["Hardware failure", "Web application attacks", "Power outages", "Network latency"], "answer": 1},
        {"q": "What is XSS?", "options": ["Cross-Site Scripting", "XML Security Standard", "External Server Service", "Cross-System Sync"], "answer": 0},
        {"q": "Which encryption type uses a shared key?", "options": ["Asymmetric", "Symmetric", "Hashing", "Salting"], "answer": 1},
        {"q": "What is a zero-day vulnerability?", "options": ["A bug found on day zero of development", "An unknown exploit with no patch available", "A vulnerability that takes zero days to fix", "A test vulnerability"], "answer": 1},
        {"q": "What does CORS stand for?", "options": ["Cross-Origin Resource Sharing", "Central Origin Request Service", "Cloud Object Resource System", "Cross-Origin Remote Security"], "answer": 0},
        {"q": "What is OAuth used for?", "options": ["Encryption", "Authorization delegation", "Password hashing", "Firewall management"], "answer": 1},
        {"q": "What is a CSRF attack?", "options": ["Cross-Site Request Forgery", "Central Server Request Failure", "Client-Side Resource Fetch", "Cross-System Remote Function"], "answer": 0},
        {"q": "What tool scans for container vulnerabilities?", "options": ["Terraform", "Trivy", "Ansible", "Grafana"], "answer": 1},
        {"q": "What is encryption at rest?", "options": ["Encrypting data during transfer", "Encrypting stored data", "Encrypting source code", "Encrypting log files only"], "answer": 1},
    ],
    "distributed": [
        {"q": "What does the CAP theorem state?", "options": ["You can have all three guarantees", "You can only guarantee 2 of 3: Consistency, Availability, Partition tolerance", "Caching Always Performs better", "Clusters Are Parallel"], "answer": 1},
        {"q": "What is eventual consistency?", "options": ["Data is always consistent", "All replicas converge to same value over time", "Data is never consistent", "Consistency checked every hour"], "answer": 1},
        {"q": "What is a message broker?", "options": ["A load balancer", "Middleware for message routing between services", "A database", "A DNS server"], "answer": 1},
        {"q": "Which is a distributed consensus algorithm?", "options": ["Bubble Sort", "Raft", "Dijkstra", "Binary Search"], "answer": 1},
        {"q": "What is horizontal scaling?", "options": ["Adding more RAM", "Adding more machines", "Upgrading CPU", "Using faster disks"], "answer": 1},
        {"q": "What is Redis primarily used for?", "options": ["Relational data storage", "In-memory caching and pub/sub", "File storage", "CI/CD pipelines"], "answer": 1},
        {"q": "What is a circuit breaker pattern?", "options": ["A hardware fuse", "Prevents cascading failures in distributed systems", "A network switch", "A load balancing algorithm"], "answer": 1},
        {"q": "What does gRPC use for serialization?", "options": ["JSON", "XML", "Protocol Buffers", "YAML"], "answer": 2},
        {"q": "What is sharding?", "options": ["Splitting data across multiple databases", "Encrypting data", "Caching data", "Compressing data"], "answer": 0},
        {"q": "What is a microservices architecture?", "options": ["One large monolithic application", "Small independent services communicating via APIs", "A frontend framework", "A database design pattern"], "answer": 1},
        {"q": "What is idempotency?", "options": ["Running once gives same result as running multiple times", "Running faster each time", "Running in parallel", "Running backwards"], "answer": 0},
        {"q": "What is a dead letter queue?", "options": ["A queue for spam emails", "Stores messages that failed processing", "A deprecated feature", "A queue that is empty"], "answer": 1},
        {"q": "What is service discovery?", "options": ["Finding bugs in services", "Automatically detecting network locations of services", "Discovering new APIs", "A documentation tool"], "answer": 1},
        {"q": "What is the two-phase commit protocol?", "options": ["A Git branching strategy", "A distributed transaction protocol ensuring atomicity", "A deployment strategy", "A testing methodology"], "answer": 1},
        {"q": "What is back-pressure in distributed systems?", "options": ["Network latency", "Mechanism to handle overload by slowing producers", "Data compression", "A security measure"], "answer": 1},
    ],
}

def handler(event, context):
    path = event.get("rawPath", "/")
    params = event.get("queryStringParameters", {}) or {}
    topic = params.get("topic", params.get("category", "cloud")).lower()
    count = int(params.get("count", 5))

    questions = QUESTION_BANK.get(topic, QUESTION_BANK["cloud"])
    selected = random.sample(questions, min(count, len(questions)))

    body = {
        "questions": selected,
        "category": topic,
        "difficulty": "medium",
        "count": len(selected),
        "generated_at": datetime.utcnow().isoformat(),
        "source": "aws-lambda"
    }

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body)
    }
