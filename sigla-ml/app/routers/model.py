from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import List, Optional
import hashlib
import httpx
import os
from app.services.train   import train
from app.services.test    import test
from app.services.deploy  import deploy
from app.services.video   import generate_word_video
from app.services.extract import extract_motion_landmarks

router = APIRouter(prefix="", tags=["Model"])


# ── Why every handler below offloads its work ─────────────────
#
# These endpoints are `async def`, which means FastAPI runs them ON the event
# loop rather than in its threadpool. train(), test(), deploy(),
# generate_word_video() and extract_motion_landmarks() are all synchronous and
# CPU-bound, so calling them directly blocked the whole service for their entire
# duration — one clip extraction (20-33s measured) stalled every other request,
# and a training run (tens of minutes) froze the service outright.
#
# run_in_threadpool moves the call to a worker thread and leaves the loop free.
# This helps here specifically because MediaPipe and TensorFlow release the GIL
# inside their native code; pure-Python work would still serialize.


# ── Request schemas ───────────────────────────────────────────

class TrainRequest(BaseModel):
    version_number: str
    model_id:       int
    # Restrict the model to these classes. Omitted or null trains on every
    # approved class, which is what this endpoint did before separate
    # vocabularies existed — see train() for why the alphabet needs its own.
    word_labels:    Optional[List[str]] = None

class TestRequest(BaseModel):
    version_number: str
    model_id:       int

class DeployRequest(BaseModel):
    version_number: str
    model_id:       int
    tflite_url:     Optional[str] = None

class ChecksumRequest(BaseModel):
    tflite_url: str  # Supabase URL of the TFLite file to verify


# ── Helper: compute SHA256 checksum of a file from URL ────────
async def compute_sha256_from_url(url: str) -> str:
    """
    Downloads the TFLite file from Supabase and computes its SHA256 hash.
    The mobile app uses this hash to verify the downloaded model is complete
    and not corrupted before replacing the active model.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=60.0)
        if response.status_code != 200:
            raise ValueError(f"Failed to fetch file from URL. Status: {response.status_code}")
        content = response.content

    sha256_hash = hashlib.sha256(content).hexdigest()
    return sha256_hash


# ── Routes ────────────────────────────────────────────────────

@router.post("/train")
async def train_model(request: TrainRequest):
    """
    Trigger model training.
    Called by Node.js backend when admin clicks Train Model.
    """
    try:
        result = await run_in_threadpool(
            train,
            version_number=request.version_number,
            model_id=request.model_id,
            word_labels=request.word_labels,
        )
        return {
            "message":           "Model trained successfully",
            "result":            result,
            "accuracy":          result.get("accuracy"),
            "total_classes":     result.get("total_classes"),
            "tflite_url":        result.get("tflite_url"),
            "h5_url":            result.get("h5_url"),
            # Lifted out of `result` so the caller does not have to reach into
            # it to learn which classes this model covers.
            "trained_labels":    result.get("trained_labels"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")


@router.post("/test")
async def test_model(request: TestRequest):
    """
    Evaluate a trained model before deployment.
    Called by Node.js backend when admin clicks Test Model.
    """
    try:
        result = await run_in_threadpool(
            test,
            version_number=request.version_number,
            model_id=request.model_id,
        )
        m = result["motion_model"]
        return {
            "message":    "Model evaluated successfully",
            "result":     result,
            "accuracy":   m["accuracy"],
            "precision":  m["precision"],
            "recall":     m["recall"],
            "f1_score":   m["f1_score"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


@router.post("/deploy")
async def deploy_model(request: DeployRequest):
    """
    Validate a trained model's immutable, version-specific artifacts.

    The Node.js backend owns the atomic model_versions status transaction.
    """
    try:
        result = await run_in_threadpool(
            deploy,
            version_number=request.version_number,
            model_id=request.model_id,
            tflite_url=request.tflite_url,
        )
        return {
            "message": "Model deployed successfully",
            "result":  result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")


@router.post("/checksum")
async def get_model_checksum(request: ChecksumRequest):
    """
    Computes and returns the SHA256 checksum of a TFLite model file.

    The mobile app calls this endpoint after downloading a new model.
    It compares the returned checksum against the downloaded file's hash.
    If they match, the model is verified and replaces the active model.
    If they do not match, the download is discarded and the old model stays active.

    Called by: Kotlin ModelUpdateService after background model download.
    """
    try:
        if not request.tflite_url:
            raise HTTPException(status_code=400, detail="tflite_url is required")

        checksum = await compute_sha256_from_url(request.tflite_url)

        return {
            "checksum":   checksum,
            "algorithm":  "SHA256",
            "tflite_url": request.tflite_url,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="Request timed out while fetching model file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Checksum computation failed: {str(e)}")


@router.get("/checksum")
async def get_deployed_model_checksum():
    try:
        # Fixed path — deploy.py always copies to deployed/ folder
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_bucket = os.getenv("SUPABASE_BUCKET_MODELS", "models")

        if not supabase_url:
            raise HTTPException(status_code=500, detail="SUPABASE_URL not configured")

        deployed_url = f"{supabase_url}/storage/v1/object/public/{supabase_bucket}/deployed/sign_model_motion.tflite"

        checksum = await compute_sha256_from_url(deployed_url)

        return {
            "checksum":    checksum,
            "algorithm":   "SHA256",
            "tflite_url":  deployed_url,
        }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="Request timed out while fetching model file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Checksum computation failed: {str(e)}")


class VideoRequest(BaseModel):
    word_id: int
    word_label: str

@router.post("/generate-video")
async def generate_video(request: VideoRequest):
    """
    Generates a short demonstration video from approved gesture images.
    Called by backend when a word becomes active.
    """
    try:
        from app.services.video import generate_word_video
        video_url = await run_in_threadpool(
            generate_word_video, request.word_id, request.word_label
        )
        return {"video_url": video_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video generation failed: {str(e)}")


@router.post("/extract-landmarks")
async def extract_landmarks(file: UploadFile = File(...)):
    """
    Extract a MediaPipe hand-landmark motion sequence (30×126) from an uploaded
    video. Every gesture is treated as motion. Called by the Node.js backend for
    each video file uploaded by an admin.
    """
    try:
        video_bytes = await file.read()
        sequence = await run_in_threadpool(
            extract_motion_landmarks, video_bytes, file.filename
        )
        if sequence is None:
            raise HTTPException(status_code=422, detail="No hands detected in video")
        return {"type": "motion", "sequence": sequence}
    except HTTPException:
        raise
    except ValueError as e:
        # Extraction quality failures are actionable client errors (too few hand
        # frames, missing upper body, or a frozen clip), not ML-service crashes.
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Landmark extraction failed: {str(e)}")
