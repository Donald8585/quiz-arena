from fastapi import WebSocket
from typing import Dict, List

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, username: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][username] = websocket

    def disconnect(self, websocket: WebSocket, room_id: str, username: str):
        if room_id in self.rooms:
            self.rooms[room_id].pop(username, None)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_to_room(self, room_id: str, message: str):
        if room_id in self.rooms:
            dead = []
            for username, ws in self.rooms[room_id].items():
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(username)
            for u in dead:
                self.rooms[room_id].pop(u, None)

    def get_room_users(self, room_id: str) -> List[str]:
        return list(self.rooms[room_id].keys()) if room_id in self.rooms else []
