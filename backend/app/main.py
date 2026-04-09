import os, json, asyncio, logging, time, random
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from jose import jwt
import redis.asyncio as aioredis
import httpx
from app.models.database import engine, Base, async_session, GameResult
from app.routers import quiz, users
from app.models.manager import ConnectionManager

INSTANCE_ID = os.getenv("INSTANCE_ID", "unknown")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
LAMBDA_URL = os.getenv("LAMBDA_URL", "http://lambda-mock:9000")
LAMBDA_FUNCTION_NAME = os.getenv("LAMBDA_FUNCTION_NAME", "quiz-arena-questions")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
JWT_SECRET = os.getenv("JWT_SECRET", "quiz-arena-secret-key")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("quiz-arena")

REQUEST_COUNT = Counter("quiz_requests_total", "Total requests", ["method", "endpoint", "instance", "status"])
WS_CONNECTIONS = Counter("ws_connections_total", "Total WS", ["instance"])
WS_ACTIVE = Gauge("ws_active_connections", "Active WS", ["instance"])
QUIZ_ANSWERS = Counter("quiz_answers_total", "Answers", ["instance", "correct"])
REQUEST_LATENCY = Histogram("request_latency_seconds", "Latency", ["endpoint", "instance"])
LAMBDA_CALLS = Counter("lambda_calls_total", "Lambda", ["instance", "status"])
LAMBDA_LATENCY = Histogram("lambda_latency_seconds", "Lambda latency", ["instance"])

redis_client = None
manager = ConnectionManager()
pubsub = None
lambda_client = None

FALLBACK_QUESTIONS = {
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
    ],
    "devops": [
        {"q": "What does CI/CD stand for?", "options": ["Continuous Integration/Continuous Deployment", "Code Integration/Code Delivery", "Continuous Inspection/Continuous Development", "Central Integration/Central Delivery"], "answer": 0},
        {"q": "Which tool is commonly used for container orchestration?", "options": ["Jenkins", "Kubernetes", "Ansible", "Terraform"], "answer": 1},
        {"q": "What is the purpose of a Dockerfile?", "options": ["Run tests", "Define container image build steps", "Deploy to production", "Monitor applications"], "answer": 1},
        {"q": "Which command lists running Docker containers?", "options": ["docker images", "docker ps", "docker run", "docker list"], "answer": 1},
        {"q": "What is Terraform primarily used for?", "options": ["CI/CD pipelines", "Infrastructure as Code", "Application monitoring", "Log management"], "answer": 1},
        {"q": "What does git rebase do?", "options": ["Delete a branch", "Reapply commits on top of another base", "Merge two branches", "Reset to initial commit"], "answer": 1},
        {"q": "Which file defines a Docker Compose setup?", "options": ["Dockerfile", "docker-compose.yml", "Makefile", "package.json"], "answer": 1},
        {"q": "What is a rolling deployment?", "options": ["Deploy all at once", "Gradually replace old with new instances", "Deploy to staging only", "Rollback deployment"], "answer": 1},
        {"q": "Which tool is used for secrets management?", "options": ["GitHub Actions", "HashiCorp Vault", "Docker Hub", "Nginx"], "answer": 1},
        {"q": "What does a load balancer do?", "options": ["Store data", "Distribute traffic across servers", "Build containers", "Run CI pipelines"], "answer": 1},
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
        {"q": "What is a zero-day vulnerability?", "options": ["A bug found on day zero", "An unknown exploit with no patch available", "A vulnerability that takes zero days to fix", "A test vulnerability"], "answer": 1},
    ],
    "distributed": [
        {"q": "What does the CAP theorem state?", "options": ["You can have all three", "You can only guarantee 2 of 3: C, A, P", "Caching Always Performs better", "Clusters Are Parallel"], "answer": 1},
        {"q": "What is eventual consistency?", "options": ["Data is always consistent", "All replicas converge to same value over time", "Data is never consistent", "Consistency checked every hour"], "answer": 1},
        {"q": "What is a message broker?", "options": ["A load balancer", "Middleware for message routing between services", "A database", "A DNS server"], "answer": 1},
        {"q": "Which is a distributed consensus algorithm?", "options": ["Bubble Sort", "Raft", "Dijkstra", "Binary Search"], "answer": 1},
        {"q": "What is horizontal scaling?", "options": ["Adding more RAM", "Adding more machines", "Upgrading CPU", "Using faster disks"], "answer": 1},
        {"q": "What is Redis primarily used for?", "options": ["Relational data storage", "In-memory caching and pub/sub", "File storage", "CI/CD pipelines"], "answer": 1},
        {"q": "What is a circuit breaker pattern?", "options": ["A hardware fuse", "Prevents cascading failures in distributed systems", "A network switch", "A load balancing algorithm"], "answer": 1},
        {"q": "What does gRPC use for serialization?", "options": ["JSON", "XML", "Protocol Buffers", "YAML"], "answer": 2},
        {"q": "What is sharding?", "options": ["Splitting data across multiple databases", "Encrypting data", "Caching data", "Compressing data"], "answer": 0},
        {"q": "What is idempotency?", "options": ["Running once gives same result as running multiple times", "Running faster each time", "Running in parallel", "Running backwards"], "answer": 0},
    ],
}

def create_token(username):
    return jwt.encode({"sub": username, "exp": datetime.utcnow() + timedelta(hours=24)}, JWT_SECRET, algorithm="HS256")

def transform_questions(raw_questions):
    letters = ["A", "B", "C", "D"]
    mapped = []
    for q in raw_questions:
        opts = q.get("options", [])
        answer_idx = q.get("answer", 0)
        mapped.append({
            "question_text": q.get("q", ""),
            "option_a": opts[0] if len(opts) > 0 else "",
            "option_b": opts[1] if len(opts) > 1 else "",
            "option_c": opts[2] if len(opts) > 2 else "",
            "option_d": opts[3] if len(opts) > 3 else "",
            "correct_answer": letters[answer_idx] if answer_idx < 4 else "A"
        })
    return mapped

def get_fallback_questions(topic, count):
    qs = FALLBACK_QUESTIONS.get(topic, FALLBACK_QUESTIONS["cloud"])
    selected = random.sample(qs, min(count, len(qs)))
    return transform_questions(selected)


# =====================================================================
# DB PERSISTENCE — writes finished game data from Redis → PostgreSQL
# Uses the GameResult ORM model from database.py
# =====================================================================
async def persist_game_results(room_id: str):
    """Persist finished game results from Redis to PostgreSQL."""
    try:
        scores = await redis_client.zrevrange(
            f"room:{room_id}:scores", 0, -1, withscores=True
        )
        if not scores:
            logger.info(f"[DB] No scores to persist for room {room_id}")
            return

        async with async_session() as session:
            async with session.begin():
                for player, score in scores:
                    session.add(GameResult(
                        room_id=room_id,
                        username=player,
                        score=int(score),
                    ))

        logger.info(f"[DB] Persisted results for room {room_id}: {len(scores)} players")

    except Exception as e:
        logger.error(f"[DB ERROR] Failed to persist room {room_id}: {e}")


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if redis_client and request.url.path not in ["/health", "/metrics"]:
            key = f"ratelimit:{request.client.host}:{int(time.time()) // 60}"
            try:
                count = await redis_client.incr(key)
                if count == 1: await redis_client.expire(key, 60)
                if count > 100:
                    return Response(content='{"detail":"Rate limited"}', status_code=429, media_type='application/json')
            except Exception: pass
        return await call_next(request)

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.time()
        response = await call_next(request)
        if request.url.path not in ["/metrics", "/health"]:
            REQUEST_COUNT.labels(method=request.method, endpoint=request.url.path, instance=INSTANCE_ID, status=response.status_code).inc()
            REQUEST_LATENCY.labels(endpoint=request.url.path, instance=INSTANCE_ID).observe(time.time() - start)
        return response

async def wait_for_db(retries=30, delay=2):
    for i in range(retries):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info(f"DB ready attempt {i+1}"); return
        except Exception as e:
            logger.warning(f"DB not ready ({i+1}): {e}"); await asyncio.sleep(delay)
    raise Exception("DB failed")

@asynccontextmanager
async def lifespan(app):
    global redis_client, pubsub, lambda_client
    await wait_for_db()
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("quiz_events")
    asyncio.create_task(redis_listener())
    try:
        import boto3
        lambda_client = boto3.client("lambda", region_name=AWS_REGION)
        logger.info("Lambda client initialized (boto3)")
    except Exception as e:
        logger.warning(f"boto3 Lambda client failed: {e}")
        lambda_client = None
    logger.info("Started!"); yield
    await pubsub.unsubscribe("quiz_events"); await redis_client.close(); await engine.dispose()

async def redis_listener():
    while True:
        try:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg["type"] == "message":
                data = json.loads(msg["data"])
                if data.get("source") != INSTANCE_ID:
                    room_id = data.get("room_id")
                    if room_id: await manager.broadcast_to_room(room_id, json.dumps(data))
            await asyncio.sleep(0.01)
        except Exception as e:
            logger.error(f"Redis listener: {e}"); await asyncio.sleep(1)

app = FastAPI(title="Quiz Arena API", lifespan=lifespan)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(quiz.router, prefix="/api/quiz", tags=["quiz"])
app.include_router(users.router, prefix="/api/users", tags=["users"])

@app.get("/health")
async def health(): return {"status": "ok", "instance": INSTANCE_ID}
@app.get("/metrics")
async def metrics(): return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/generate-questions")
async def generate_questions(topic: str = "cloud", count: int = 5):
    start = time.time()
    try:
        result = None
        if lambda_client:
            try:
                payload = json.dumps({"rawPath": "/generate", "queryStringParameters": {"topic": topic, "count": str(count)}})
                resp = lambda_client.invoke(FunctionName=LAMBDA_FUNCTION_NAME, Payload=payload)
                raw = json.loads(resp["Payload"].read())
                if "body" in raw:
                    raw = json.loads(raw["body"])
                if "questions" in raw:
                    result = {"questions": transform_questions(raw["questions"]), "category": topic, "source": "lambda"}
            except Exception as e:
                logger.warning(f"Lambda failed, using fallback: {e}")
        if not result:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    url = LAMBDA_URL.rstrip("/")
                    resp = await client.get(f"{url}/generate", params={"topic": topic, "count": count})
                    resp.raise_for_status()
                    raw = resp.json()
                    if "questions" in raw:
                        result = {"questions": transform_questions(raw["questions"]), "category": topic, "source": "lambda-url"}
            except Exception as e:
                logger.warning(f"HTTP Lambda failed, using fallback: {e}")
        if not result:
            result = {"questions": get_fallback_questions(topic, count), "category": topic, "source": "fallback"}
        LAMBDA_CALLS.labels(instance=INSTANCE_ID, status="success").inc()
        LAMBDA_LATENCY.labels(instance=INSTANCE_ID).observe(time.time() - start)
        return result
    except Exception as e:
        LAMBDA_CALLS.labels(instance=INSTANCE_ID, status="error").inc()
        return {"questions": get_fallback_questions(topic, count), "category": topic, "source": "fallback-error"}

async def get_room_state(room_id):
    state = await redis_client.hgetall(f"room:{room_id}:state")
    players = list(await redis_client.smembers(f"room:{room_id}:players"))
    ready = list(await redis_client.smembers(f"room:{room_id}:ready"))
    votes_raw = await redis_client.hgetall(f"room:{room_id}:votes")
    return {
        "players": players, "ready": ready, "votes": votes_raw,
        "phase": state.get("phase", "lobby"),
        "question_idx": int(state.get("question_idx", "0")),
        "total_questions": int(state.get("total_questions", "0")),
    }

async def get_leaderboard(room_id):
    score_key = f"room:{room_id}:scores"
    lb = await redis_client.zrevrange(score_key, 0, -1, withscores=True)
    return [{"username": u, "score": int(s)} for u, s in lb]

async def broadcast_and_publish(room_id, msg_dict):
    raw = json.dumps(msg_dict)
    await redis_client.publish("quiz_events", raw)
    await manager.broadcast_to_room(room_id, raw)

@app.websocket("/ws/{room_id}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str):
    await manager.connect(websocket, room_id, username)
    WS_CONNECTIONS.labels(instance=INSTANCE_ID).inc()
    WS_ACTIVE.labels(instance=INSTANCE_ID).inc()

    await redis_client.sadd(f"room:{room_id}:players", username)
    await redis_client.expire(f"room:{room_id}:players", 3600)

    # --- replay history to this client only ---
    state = await get_room_state(room_id)
    for p in state["players"]:
        if p != username:
            try: await websocket.send_text(json.dumps({"type": "player_joined", "room_id": room_id, "username": p, "source": "history"}))
            except: pass
    for p in state["ready"]:
        try: await websocket.send_text(json.dumps({"type": "player_ready", "room_id": room_id, "username": p, "source": "history"}))
        except: pass
    for voter, topic in state["votes"].items():
        try: await websocket.send_text(json.dumps({"type": "vote_topic", "room_id": room_id, "username": voter, "topic": topic, "source": "history"}))
        except: pass

    # --- send state snapshot so late joiners sync phase + question ---
    snapshot = {
        "type": "state_snapshot",
        "room_id": room_id,
        "phase": state["phase"],
        "question_idx": state["question_idx"],
        "total_questions": state["total_questions"],
        "source": "history",
    }
    if state["phase"] in ("playing", "reviewing") and state["total_questions"] > 0:
        raw_qs = await redis_client.get(f"room:{room_id}:questions")
        if raw_qs:
            questions = json.loads(raw_qs)
            idx = state["question_idx"]
            if 0 <= idx < len(questions):
                q = questions[idx]
                snapshot["current_question"] = q
                snapshot["question_number"] = idx + 1
                snapshot["total"] = len(questions)
                snapshot["time_limit"] = 15
    lb = await get_leaderboard(room_id)
    if lb:
        snapshot["leaderboard"] = lb
    try: await websocket.send_text(json.dumps(snapshot))
    except: pass

    # --- broadcast join to everyone ---
    join_msg = {"type": "player_joined", "room_id": room_id, "username": username, "source": INSTANCE_ID}
    await broadcast_and_publish(room_id, join_msg)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            message["room_id"] = room_id
            message["username"] = username
            message["source"] = INSTANCE_ID
            msg_type = message.get("type")

            if msg_type == "player_ready":
                await redis_client.sadd(f"room:{room_id}:ready", username)
                await redis_client.expire(f"room:{room_id}:ready", 3600)
                await broadcast_and_publish(room_id, message)

            elif msg_type == "vote_topic":
                await redis_client.hset(f"room:{room_id}:votes", username, message.get("topic", "cloud"))
                await redis_client.expire(f"room:{room_id}:votes", 3600)
                await broadcast_and_publish(room_id, message)

            elif msg_type == "game_start":
                await redis_client.hset(f"room:{room_id}:state", mapping={
                    "phase": "playing", "question_idx": "0",
                    "total_questions": str(message.get("total_questions", 5)),
                })
                if message.get("questions"):
                    await redis_client.set(f"room:{room_id}:questions", json.dumps(message["questions"]), ex=3600)
                await redis_client.delete(f"room:{room_id}:scores")
                await broadcast_and_publish(room_id, message)

            elif msg_type == "new_question":
                # SERVER-AUTHORITATIVE: read next question from Redis
                raw_qs = await redis_client.get(f"room:{room_id}:questions")
                if not raw_qs:
                    continue
                questions = json.loads(raw_qs)
                current_idx = int((await redis_client.hget(f"room:{room_id}:state", "question_idx")) or "0")
                phase = (await redis_client.hget(f"room:{room_id}:state", "phase")) or "playing"
                if phase == "playing" and current_idx == 0:
                    next_idx = 0
                else:
                    next_idx = current_idx + 1

                if next_idx >= len(questions):
                    # ===== GAME OVER — persist to DB before cleanup =====
                    lb = await get_leaderboard(room_id)
                    await persist_game_results(room_id)
                    finish_msg = {
                        "type": "game_finished", "room_id": room_id,
                        "leaderboard": lb, "source": INSTANCE_ID,
                    }
                    await redis_client.hset(f"room:{room_id}:state", "phase", "finished")
                    await redis_client.delete(
                        f"room:{room_id}:ready",
                        f"room:{room_id}:votes",
                        f"room:{room_id}:questions",
                    )
                    await broadcast_and_publish(room_id, finish_msg)
                    continue

                await redis_client.hset(f"room:{room_id}:state", mapping={
                    "question_idx": str(next_idx), "phase": "playing",
                })
                await redis_client.delete(f"room:{room_id}:answered")
                q = questions[next_idx]
                out = {
                    "type": "new_question", "room_id": room_id,
                    "question_text": q.get("question_text", ""),
                    "option_a": q.get("option_a", ""),
                    "option_b": q.get("option_b", ""),
                    "option_c": q.get("option_c", ""),
                    "option_d": q.get("option_d", ""),
                    "correct_answer": q.get("correct_answer", "A"),
                    "question_number": next_idx + 1,
                    "total": len(questions),
                    "time_limit": 15,
                    "source": INSTANCE_ID,
                }
                await broadcast_and_publish(room_id, out)

            elif msg_type == "player_answered":
                await redis_client.sadd(f"room:{room_id}:answered", username)
                await redis_client.expire(f"room:{room_id}:answered", 3600)
                await broadcast_and_publish(room_id, message)

            elif msg_type == "reveal_answer":
                await redis_client.hset(f"room:{room_id}:state", "phase", "reviewing")
                lb = await get_leaderboard(room_id)
                message["leaderboard"] = lb
                await broadcast_and_publish(room_id, message)

            elif msg_type == "game_finished":
                # ===== EXPLICIT game_finished — persist to DB =====
                await persist_game_results(room_id)
                await redis_client.hset(f"room:{room_id}:state", "phase", "finished")
                lb = await get_leaderboard(room_id)
                message["leaderboard"] = lb
                await redis_client.delete(
                    f"room:{room_id}:ready",
                    f"room:{room_id}:votes",
                    f"room:{room_id}:questions",
                )
                await broadcast_and_publish(room_id, message)

            elif msg_type == "answer":
                QUIZ_ANSWERS.labels(instance=INSTANCE_ID, correct=str(message.get("correct", False))).inc()
                score_key = f"room:{room_id}:scores"
                await redis_client.zincrby(score_key, message.get("points", 0), username)
                await redis_client.expire(score_key, 3600)
                lb = await get_leaderboard(room_id)
                message["leaderboard"] = lb
                await broadcast_and_publish(room_id, message)

            elif msg_type == "back_to_lobby":
                await redis_client.hset(f"room:{room_id}:state", mapping={
                    "phase": "lobby", "question_idx": "0", "total_questions": "0",
                })
                await redis_client.delete(
                    f"room:{room_id}:ready", f"room:{room_id}:votes",
                    f"room:{room_id}:questions", f"room:{room_id}:scores",
                    f"room:{room_id}:answered",
                )
                await broadcast_and_publish(room_id, message)

            elif msg_type == "chat":
                await broadcast_and_publish(room_id, message)

            else:
                await broadcast_and_publish(room_id, message)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id, username)
        WS_ACTIVE.labels(instance=INSTANCE_ID).dec()
        await redis_client.srem(f"room:{room_id}:players", username)
        await redis_client.srem(f"room:{room_id}:ready", username)
        leave_msg = {"type": "player_left", "room_id": room_id, "username": username, "source": INSTANCE_ID}
        await broadcast_and_publish(room_id, leave_msg)
