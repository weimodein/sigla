from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Header
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import List, Optional
import os
import secrets
from threading import Lock
from app.services.train   import train
from app.services.test    import test
from app.services.extract import extract_motion_landmarks

router = APIRouter(prefix="", tags=["Model"])

# The backend asks for this while the long-running /train request is executing.
# Keep progress in this process so epoch callbacks can update it without making
# an extra network request (or slowing TensorFlow down).
_training_progress = {}
_training_progress_lock = Lock()


def _record_training_progress(model_id: int, update: dict) -> None:
    with _training_progress_lock:
        _training_progress[model_id] = update


@router.get("/training/{model_id}/progress")
async def get_training_progress(model_id: int, x_api_key: Optional[str] = Header(default=None)):
    expected_key = os.getenv("ML_API_KEY")
    if not expected_key or not x_api_key or not secrets.compare_digest(x_api_key, expected_key):
        raise HTTPException(status_code=401, detail="Unauthorized")

    with _training_progress_lock:
        progress = _training_progress.get(model_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="No progress is available for this model")
    return {"progress": progress}


# ── Why every handler below offloads its work ─────────────────
#
# These endpoints are `async def`, which means FastAPI runs them ON the event
# loop rather than in its threadpool. train(), test() and
# extract_motion_landmarks() are all synchronous and
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

# ── Routes ────────────────────────────────────────────────────

@router.post("/train")
async def train_model(request: TrainRequest):
    """
    Trigger model training.
    Called by Node.js backend when admin clicks Train Model.
    """
    _record_training_progress(request.model_id, {
        "progress": 0,
        "stage": "starting",
        "stage_label": "Starting training",
        "current_epoch": None,
        "total_epochs": None,
    })

    def report_progress(update: dict) -> None:
        _record_training_progress(request.model_id, update)

    try:
        result = await run_in_threadpool(
            train,
            version_number=request.version_number,
            model_id=request.model_id,
            word_labels=request.word_labels,
            progress_callback=report_progress,
        )
        report_progress({
            "progress": 100,
            "stage": "completed",
            "stage_label": "Training complete",
            "current_epoch": None,
            "total_epochs": None,
        })
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
        report_progress({
            "progress": 0,
            "stage": "failed",
            "stage_label": "Training failed",
            "current_epoch": None,
            "total_epochs": None,
        })
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        report_progress({
            "progress": 0,
            "stage": "failed",
            "stage_label": "Training failed",
            "current_epoch": None,
            "total_epochs": None,
        })
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
