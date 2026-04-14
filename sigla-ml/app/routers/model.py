from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import hashlib
import httpx
import os
from app.services.train  import train
from app.services.test   import test
from app.services.deploy import deploy
from app.services.video import generate_word_video

router = APIRouter(prefix="", tags=["Model"])


# ── Request schemas ───────────────────────────────────────────

class TrainRequest(BaseModel):
    version_number: str
    model_id:       int

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
        result = train(
            version_number=request.version_number,
            model_id=request.model_id,
        )
        return {
            "message":           "Model trained successfully",
            "result":            result,
            "accuracy":          result.get("accuracy"),
            "total_classes":     result.get("total_classes"),
            "tflite_url":        result.get("tflite_url"),
            "h5_url":            result.get("h5_url"),
            "motion_tflite_url": result.get("motion_tflite_url"),
            "motion_h5_url":     result.get("motion_h5_url"),
            "motion_accuracy":   result.get("motion_accuracy"),
            "motion_trained":    result.get("motion_trained"),
            "motion_classes":    result.get("motion_classes"),
            "gesture_config_url": result.get("gesture_config_url"),
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
        result = test(
            version_number=request.version_number,
            model_id=request.model_id,
        )
        return {
            "message":    "Model evaluated successfully",
            "result":     result,
            "accuracy":   result["static_model"]["accuracy"],
            "precision":  result["static_model"]["precision"],
            "recall":     result["static_model"]["recall"],
            "f1_score":   result["static_model"]["f1_score"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


@router.post("/deploy")
async def deploy_model(request: DeployRequest):
    """
    Deploy a trained model — copies files to deployed/ folder in Supabase.
    Called by Node.js backend when admin clicks Deploy Model.
    """
    try:
        result = deploy(
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

        deployed_url = f"{supabase_url}/storage/v1/object/public/{supabase_bucket}/deployed/sign_model_static.tflite"

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
        video_url = generate_word_video(request.word_id, request.word_label)
        return {"video_url": video_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video generation failed: {str(e)}")