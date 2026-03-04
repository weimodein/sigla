from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from app.services.train  import train
from app.services.test   import test
from app.services.deploy import deploy

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
            "message": "Model trained successfully",
            "result":  result,
            # Return these at top level so Node.js can update the DB record directly
            "accuracy":      result.get("accuracy"),
            "precision":     result.get("precision"),
            "recall":        result.get("recall"),
            "f1_score":      result.get("f1_score"),
            "total_classes": result.get("total_classes"),
            "tflite_url":    result.get("tflite_url"),
            "h5_url":        result.get("h5_url"),
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
            # Return these at top level so Node.js can update DB record
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