from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import List
import uuid
from datetime import datetime, timezone, timedelta
import csv
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(exist_ok=True)

# ============================================================================
# IN-MEMORY STORAGE (no database needed)
# ============================================================================
sessions = {}       # session_token -> {user_id, email, expires_at}
scan_sessions = {}  # user_email -> {codes: [{barcode, timestamp}], session_id}

# ============================================================================
# MODELS
# ============================================================================

class EmailLoginRequest(BaseModel):
    email: str

class BarcodeSubmit(BaseModel):
    barcode: str

class SessionStatsResponse(BaseModel):
    barcode_count: int
    barcodes: List[str]
    session_id: str
    is_duplicate: bool = False

# ============================================================================
# AUTH HELPER
# ============================================================================

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

def get_current_user(request: Request) -> dict:
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
    if not token:
        token = request.cookies.get("session_token")
    if not token or token not in sessions:
        raise HTTPException(status_code=401, detail="No autenticado")

    session = sessions[token]
    if session["expires_at"] < datetime.now(timezone.utc):
        del sessions[token]
        raise HTTPException(status_code=401, detail="Sesión expirada")

    return session

# ============================================================================
# AUTH ROUTES
# ============================================================================

@api_router.post("/auth/login")
async def email_login(body: EmailLoginRequest):
    email = body.email.strip().lower()
    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=400, detail="Formato de correo inválido")

    token = uuid.uuid4().hex
    sessions[token] = {
        "user_id": f"user_{uuid.uuid4().hex[:8]}",
        "email": email,
        "name": email.split("@")[0],
        "expires_at": datetime.now(timezone.utc) + timedelta(days=30)
    }

    return {
        "email": email,
        "name": email.split("@")[0],
        "session_token": token
    }

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = get_current_user(request)
    return {"email": user["email"], "name": user["name"]}

@api_router.post("/auth/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
        sessions.pop(token, None)
    return {"message": "Sesión cerrada"}

# ============================================================================
# SCANNING ROUTES
# ============================================================================

def get_scan_session(email: str) -> dict:
    if email not in scan_sessions:
        scan_sessions[email] = {
            "session_id": f"session_{uuid.uuid4().hex[:8]}",
            "codes": []
        }
    return scan_sessions[email]

@api_router.post("/barcode", response_model=SessionStatsResponse)
async def save_barcode(body: BarcodeSubmit, request: Request):
    user = get_current_user(request)
    session = get_scan_session(user["email"])

    is_duplicate = any(c["barcode"] == body.barcode for c in session["codes"])

    session["codes"].append({
        "barcode": body.barcode,
        "timestamp": datetime.now(timezone.utc),
        "user_email": user["email"]
    })

    barcodes = [c["barcode"] for c in session["codes"]]
    return SessionStatsResponse(
        barcode_count=len(barcodes),
        barcodes=barcodes,
        session_id=session["session_id"],
        is_duplicate=is_duplicate
    )

@api_router.get("/session-stats", response_model=SessionStatsResponse)
async def get_session_stats(request: Request):
    user = get_current_user(request)
    session = get_scan_session(user["email"])
    barcodes = [c["barcode"] for c in session["codes"]]
    return SessionStatsResponse(
        barcode_count=len(barcodes),
        barcodes=barcodes,
        session_id=session["session_id"],
        is_duplicate=False
    )

@api_router.post("/finalize-session")
async def finalize_session(request: Request):
    user = get_current_user(request)
    email = user["email"]

    if email not in scan_sessions or not scan_sessions[email]["codes"]:
        raise HTTPException(status_code=400, detail="No hay códigos escaneados")

    session = scan_sessions[email]

    # One CSV per user per day - append if exists
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    safe_email = email.replace("@", "_").replace(".", "_")
    csv_filename = f"barras_{safe_email}_{today}.csv"
    csv_path = DATA_DIR / csv_filename

    file_exists = csv_path.exists()
    with open(csv_path, 'a', newline='', encoding='utf-8') as csvfile:
        writer = csv.writer(csvfile)
        if not file_exists:
            writer.writerow(['timestamp', 'codigo', 'usuario'])
        for entry in session["codes"]:
            writer.writerow([
                entry["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
                entry["barcode"],
                entry["user_email"]
            ])

    count = len(session["codes"])
    del scan_sessions[email]

    logger.info(f"CSV created: {csv_filename} with {count} entries")
    return {"message": "Sesión finalizada", "csv_filename": csv_filename, "barcode_count": count}

# ============================================================================
# BASIC
# ============================================================================

@api_router.get("/")
async def root():
    return {"message": "QR Scanner API - Ready"}

@api_router.get("/health")
async def health():
    return {"status": "ok"}

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend in production
FRONTEND_BUILD_DIR = Path(__file__).parent.parent / "frontend" / "build"
if FRONTEND_BUILD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_DIR / "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index_file = FRONTEND_BUILD_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        raise HTTPException(status_code=404)
