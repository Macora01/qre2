from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import csv
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Ensure /data directory exists
DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(exist_ok=True)


# ============================================================================
# MODELS
# ============================================================================

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime

class UserSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    session_token: str
    expires_at: datetime
    created_at: datetime

class BarcodeSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_id: str
    user_id: str
    user_email: str
    started_at: datetime
    finalized_at: Optional[datetime] = None
    barcode_count: int = 0

class BarcodeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entry_id: str
    barcode_session_id: str
    barcode: str
    timestamp: datetime
    user_email: str

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
# AUTHENTICATION HELPER
# ============================================================================

async def get_current_user(request: Request) -> User:
    """
    Get current authenticated user from session_token
    Checks cookie first, then Authorization header
    """
    session_token = None
    
    # Check cookie first
    session_token = request.cookies.get("session_token")
    
    # Fallback to Authorization header
    if not session_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.replace("Bearer ", "")
    
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Find session in database
    session_doc = await db.user_sessions.find_one(
        {"session_token": session_token},
        {"_id": 0}
    )
    
    if not session_doc:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Check expiry with timezone awareness
    expires_at = session_doc["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    
    # Get user data
    user_doc = await db.users.find_one(
        {"user_id": session_doc["user_id"]},
        {"_id": 0}
    )
    
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    
    return User(**user_doc)


# ============================================================================
# AUTHENTICATION ROUTES
# ============================================================================

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

@api_router.post("/auth/login")
async def email_login(body: EmailLoginRequest, response: Response):
    """
    Simple email-based login. Validates email format, creates user if needed, returns session.
    """
    email = body.email.strip().lower()

    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=400, detail="Formato de correo inválido")

    # Check if user exists
    existing_user = await db.users.find_one({"email": email}, {"_id": 0})

    if existing_user:
        user_id = existing_user["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": email.split("@")[0],
            "created_at": datetime.now(timezone.utc)
        })

    # Create session
    session_token = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)

    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    })

    # Set httpOnly cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
        max_age=30 * 24 * 60 * 60
    )

    return {
        "user_id": user_id,
        "email": email,
        "name": email.split("@")[0]
    }


@api_router.get("/auth/me")
async def get_me(request: Request):
    """
    Get current authenticated user info
    """
    user = await get_current_user(request)
    return user


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    """
    Logout user and clear session
    """
    try:
        session_token = request.cookies.get("session_token")
        if session_token:
            await db.user_sessions.delete_one({"session_token": session_token})
        
        response.delete_cookie(
            key="session_token",
            path="/",
            secure=True,
            samesite="lax"
        )
        
        return {"message": "Logged out successfully"}
    except Exception as e:
        logger.error(f"Error during logout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# BARCODE SCANNING ROUTES
# ============================================================================

@api_router.get("/current-session")
async def get_or_create_session(request: Request):
    """
    Get or create current barcode scanning session for user
    """
    user = await get_current_user(request)
    
    # Find active session (not finalized)
    active_session = await db.barcode_sessions.find_one(
        {
            "user_id": user.user_id,
            "finalized_at": None
        },
        {"_id": 0}
    )
    
    if active_session:
        return BarcodeSession(**active_session)
    
    # Create new session
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    new_session = {
        "session_id": session_id,
        "user_id": user.user_id,
        "user_email": user.email,
        "started_at": datetime.now(timezone.utc),
        "finalized_at": None,
        "barcode_count": 0
    }
    
    await db.barcode_sessions.insert_one(new_session)
    return BarcodeSession(**new_session)


@api_router.post("/barcode", response_model=SessionStatsResponse)
async def save_barcode(body: BarcodeSubmit, request: Request):
    """
    Save scanned barcode and return session stats
    Checks for duplicates and shows alert but allows saving
    """
    user = await get_current_user(request)
    
    # Get or create active session
    session = await get_or_create_session(request)
    
    # Check if barcode already exists in this session
    existing_entry = await db.barcode_entries.find_one(
        {
            "barcode_session_id": session.session_id,
            "barcode": body.barcode
        },
        {"_id": 0}
    )
    
    is_duplicate = existing_entry is not None
    
    # Save barcode entry (even if duplicate, as per requirement)
    entry_id = f"entry_{uuid.uuid4().hex[:12]}"
    await db.barcode_entries.insert_one({
        "entry_id": entry_id,
        "barcode_session_id": session.session_id,
        "barcode": body.barcode,
        "timestamp": datetime.now(timezone.utc),
        "user_email": user.email
    })
    
    # Update session barcode count
    await db.barcode_sessions.update_one(
        {"session_id": session.session_id},
        {"$inc": {"barcode_count": 1}}
    )
    
    # Get all barcodes from this session
    barcode_entries = await db.barcode_entries.find(
        {"barcode_session_id": session.session_id},
        {"_id": 0}
    ).to_list(10000)
    
    barcodes = [entry["barcode"] for entry in barcode_entries]
    
    return SessionStatsResponse(
        barcode_count=len(barcodes),
        barcodes=barcodes,
        session_id=session.session_id,
        is_duplicate=is_duplicate
    )


@api_router.get("/session-stats", response_model=SessionStatsResponse)
async def get_session_stats(request: Request):
    """
    Get current session statistics
    """
    # Verify authentication
    await get_current_user(request)
    
    # Get active session
    session = await get_or_create_session(request)
    
    # Get all barcodes from this session
    barcode_entries = await db.barcode_entries.find(
        {"barcode_session_id": session.session_id},
        {"_id": 0}
    ).to_list(10000)
    
    barcodes = [entry["barcode"] for entry in barcode_entries]
    
    return SessionStatsResponse(
        barcode_count=len(barcodes),
        barcodes=barcodes,
        session_id=session.session_id,
        is_duplicate=False
    )


@api_router.post("/finalize-session")
async def finalize_session(request: Request):
    """
    Finalize current session and generate CSV file
    Returns the CSV filename
    """
    user = await get_current_user(request)
    
    # Get active session
    active_session = await db.barcode_sessions.find_one(
        {
            "user_id": user.user_id,
            "finalized_at": None
        },
        {"_id": 0}
    )
    
    if not active_session:
        raise HTTPException(status_code=404, detail="No active session found")
    
    session_id = active_session["session_id"]
    
    # Get all barcode entries
    barcode_entries = await db.barcode_entries.find(
        {"barcode_session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", 1).to_list(10000)
    
    if not barcode_entries:
        raise HTTPException(status_code=400, detail="No barcodes in session")
    
    # Generate CSV filename with date and version
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    base_filename = f"barras_{today}"
    
    # Find next available version number
    version = 1
    while True:
        csv_filename = f"{base_filename}_v{version}.csv"
        csv_path = DATA_DIR / csv_filename
        if not csv_path.exists():
            break
        version += 1
    
    # Write CSV file
    with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
        csv_writer = csv.writer(csvfile)
        # Header
        csv_writer.writerow(['timestamp', 'codigo', 'usuario'])
        
        # Data rows
        for entry in barcode_entries:
            timestamp = entry["timestamp"]
            if isinstance(timestamp, str):
                timestamp = datetime.fromisoformat(timestamp)
            
            csv_writer.writerow([
                timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                entry["barcode"],
                entry["user_email"]
            ])
    
    # Mark session as finalized
    await db.barcode_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"finalized_at": datetime.now(timezone.utc)}}
    )
    
    logger.info(f"CSV file created: {csv_filename} with {len(barcode_entries)} entries")
    
    return {
        "message": "Session finalized successfully",
        "csv_filename": csv_filename,
        "barcode_count": len(barcode_entries)
    }


# ============================================================================
# BASIC ROUTES
# ============================================================================

@api_router.get("/")
async def root():
    return {"message": "Barcode Scanner API - Ready"}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (React frontend) for production
FRONTEND_BUILD_DIR = Path(__file__).parent.parent / "frontend" / "build"
if FRONTEND_BUILD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_DIR / "static")), name="static")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve React frontend for all non-API routes"""
        # Skip API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        
        # Serve index.html for all other routes (SPA)
        index_file = FRONTEND_BUILD_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        else:
            raise HTTPException(status_code=404, detail="Frontend not found")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
