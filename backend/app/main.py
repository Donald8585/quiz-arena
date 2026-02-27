import os, json, asyncio, logging, time
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
from app.models.database import engine, Base
from app.routers import quiz, users
from app.models.manager import ConnectionManager

INSTANCE_ID = os.getenv("INSTANCE_ID", "unknown")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
LAMBDA_URL = os.getenv("LAMBDA_URL", "http://lambda-mock:9000")
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

def create_token(username):
    return jwt.encode({"sub": username, "exp": datetime.utcnow() + timedelta(hours=24)}, JWT_SECRET, algorithm="HS256")

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
    global redis_client, pubsub
    await wait_for_db()
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("quiz_events")
    asyncio.create_task(redis_listener())
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
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{LAMBDA_URL}/generate", params={"topic": topic, "count": count})
            resp.raise_for_status(); result = resp.json()
        LAMBDA_CALLS.labels(instance=INSTANCE_ID, status="success").inc()
        LAMBDA_LATENCY.labels(instance=INSTANCE_ID).observe(time.time() - start)
        return result
    except Exception as e:
        LAMBDA_CALLS.labels(instance=INSTANCE_ID, status="error").inc()
        raise HTTPException(status_code=502, detail=str(e))

@app.websocket("/ws/{room_id}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str):
    await manager.connect(websocket, room_id, username)
    WS_CONNECTIONS.labels(instance=INSTANCE_ID).inc()
    WS_ACTIVE.labels(instance=INSTANCE_ID).inc()
    room_key = f"room:{room_id}:players"
    await redis_client.sadd(room_key, username)
    await redis_client.expire(room_key, 3600)
    existing = await redis_client.smembers(room_key)
    for p in existing:
        if p != username:
            try: await websocket.send_text(json.dumps({"type": "player_joined", "room_id": room_id, "username": p, "source": "history"}))
            except Exception: pass
    join_msg = {"type": "player_joined", "room_id": room_id, "username": username, "source": INSTANCE_ID}
    await redis_client.publish("quiz_events", json.dumps(join_msg))
    await manager.broadcast_to_room(room_id, json.dumps(join_msg))
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            message["room_id"] = room_id
            message["username"] = username
            message["source"] = INSTANCE_ID
            if message.get("type") == "answer":
                QUIZ_ANSWERS.labels(instance=INSTANCE_ID, correct=str(message.get("correct", False))).inc()
                score_key = f"room:{room_id}:scores"
                await redis_client.zincrby(score_key, message.get("points", 0), username)
                lb = await redis_client.zrevrange(score_key, 0, -1, withscores=True)
                message["leaderboard"] = [{"username": u, "score": int(s)} for u, s in lb]
            await redis_client.publish("quiz_events", json.dumps(message))
            await manager.broadcast_to_room(room_id, json.dumps(message))
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id, username)
        WS_ACTIVE.labels(instance=INSTANCE_ID).dec()
        await redis_client.srem(room_key, username)
        leave_msg = {"type": "player_left", "room_id": room_id, "username": username, "source": INSTANCE_ID}
        await redis_client.publish("quiz_events", json.dumps(leave_msg))
        await manager.broadcast_to_room(room_id, json.dumps(leave_msg))
