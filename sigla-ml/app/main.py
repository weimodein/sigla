import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from app.routers import model

load_dotenv()

app = FastAPI(
    title="SIGLA ML Service",
    description="Machine learning microservice for SIGLA — handles model training, testing, and deployment.",
    version="1.0.0"
)

# CORS — restrict to the Node.js backend only (not a browser-facing service)
_backend_url = os.getenv("BACKEND_URL", "http://localhost:3000")
_allowed_origin = _backend_url.split("/api")[0]  # strip /api path if present

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_allowed_origin],
    allow_methods=["POST", "GET"],
    allow_headers=["X-API-Key", "Content-Type"],
)

# ── Include routers ───────────────────────────────────────────
app.include_router(model.router)

# ── Health check ──────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "service": "SIGLA ML Service",
        "status":  "running",
        "version": "1.0.0"
    }

@app.get("/health")
def health():
    return { "status": "ok" }