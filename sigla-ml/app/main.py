from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="SIGLA ML Service",
    description="Machine learning microservice for SIGLA — handles model training, testing, and deployment.",
    version="1.0.0"
)

# CORS — allow Node.js backend to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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