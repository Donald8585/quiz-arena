import random, time
from fastapi import FastAPI
app = FastAPI(title="Quiz Lambda")
QUESTIONS = {
    "cloud": [
        {"question_text": "What does IaaS stand for?", "option_a": "Internet as a Service", "option_b": "Infrastructure as a Service", "option_c": "Integration as a Service", "option_d": "Intelligence as a Service", "correct_answer": "B"},
        {"question_text": "Which AWS service provides serverless compute?", "option_a": "EC2", "option_b": "EBS", "option_c": "Lambda", "option_d": "VPC", "correct_answer": "C"},
        {"question_text": "Main benefit of containerization?", "option_a": "Faster CPU", "option_b": "More RAM", "option_c": "Consistent environments", "option_d": "Free hosting", "correct_answer": "C"},
        {"question_text": "What does CDN stand for?", "option_a": "Central Data Network", "option_b": "Content Delivery Network", "option_c": "Cloud Database Node", "option_d": "Compute Distribution Network", "correct_answer": "B"},
        {"question_text": "Which is a NoSQL database?", "option_a": "PostgreSQL", "option_b": "MySQL", "option_c": "MongoDB", "option_d": "Oracle", "correct_answer": "C"},
        {"question_text": "What is Kubernetes used for?", "option_a": "Database management", "option_b": "Container orchestration", "option_c": "Code compilation", "option_d": "Network routing", "correct_answer": "B"},
    ],
    "devops": [
        {"question_text": "What does CI/CD stand for?", "option_a": "Code Integration", "option_b": "Continuous Integration/Delivery", "option_c": "Central Infrastructure", "option_d": "Cloud Integration", "correct_answer": "B"},
        {"question_text": "Docker Compose is for?", "option_a": "Music", "option_b": "Multi-container apps", "option_c": "Single container", "option_d": "Code review", "correct_answer": "B"},
        {"question_text": "Nginx commonly serves as?", "option_a": "Database", "option_b": "Reverse proxy", "option_c": "Code editor", "option_d": "Email server", "correct_answer": "B"},
        {"question_text": "Prometheus is for?", "option_a": "Logs", "option_b": "Metrics monitoring", "option_c": "File hosting", "option_d": "Email", "correct_answer": "B"},
        {"question_text": "Redis is primarily?", "option_a": "Relational DB", "option_b": "In-memory cache", "option_c": "File system", "option_d": "OS", "correct_answer": "B"},
    ],
    "security": [
        {"question_text": "What does JWT stand for?", "option_a": "Java Web Token", "option_b": "JSON Web Token", "option_c": "JS Web Transfer", "option_d": "Just Wait Then", "correct_answer": "B"},
        {"question_text": "bcrypt is for?", "option_a": "Encrypting files", "option_b": "Password hashing", "option_c": "Network routing", "option_d": "DB queries", "correct_answer": "B"},
        {"question_text": "CORS stands for?", "option_a": "Central Origin", "option_b": "Cross-Origin Resource Sharing", "option_c": "Cloud Optimized", "option_d": "Cached Object", "correct_answer": "B"},
        {"question_text": "Rate limiting prevents?", "option_a": "Speed", "option_b": "Abuse via request limits", "option_c": "Compression", "option_d": "Caching", "correct_answer": "B"},
    ],
    "distributed": [
        {"question_text": "CAP theorem states?", "option_a": "All three guaranteed", "option_b": "Only two of C/A/P", "option_c": "Always consistent", "option_d": "No partitions", "correct_answer": "B"},
        {"question_text": "Horizontal scaling means?", "option_a": "More CPU", "option_b": "More servers", "option_c": "More RAM", "option_d": "Faster disks", "correct_answer": "B"},
        {"question_text": "Pub/Sub pattern is?", "option_a": "Public Subscription", "option_b": "Publish/Subscribe messaging", "option_c": "Push/Pull", "option_d": "Peer broadcast", "correct_answer": "B"},
    ],
}
@app.get("/health")
async def health(): return {"status": "ok"}
@app.get("/generate")
async def generate(topic: str = "cloud", count: int = 5):
    start = time.time()
    avail = QUESTIONS.get(topic, QUESTIONS["cloud"])
    sel = random.sample(avail, min(count, len(avail)))
    qs = [{"id": i+1, **q, "time_limit": 15} for i, q in enumerate(sel)]
    return {"topic": topic, "count": len(qs), "questions": qs, "execution_time_ms": round((time.time()-start)*1000, 2)}
@app.get("/topics")
async def topics(): return {"topics": list(QUESTIONS.keys())}
