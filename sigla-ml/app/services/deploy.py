import os
import json
from app.utils.supabase_client import (
    download_file,
    get_public_url,
    BUCKET_MODELS,
)
from dotenv import load_dotenv

load_dotenv()

MODELS_DIR = "models"


def download_model_files(version_number: str) -> dict:
    """
    Download all model files for a version from Supabase Storage.
    Returns dict of local file paths.
    """
    local_dir = os.path.join(MODELS_DIR, version_number)
    os.makedirs(local_dir, exist_ok=True)

    # Every model is a motion (LSTM) model.
    motion_files = [
        "sign_model_motion.tflite",
        "sign_model_motion.h5",
        "labels_motion.json",
    ]

    local_paths = {}
    for filename in motion_files:
        storage_path = f"{version_number}/{filename}"
        local_path   = os.path.join(local_dir, filename)

        if os.path.exists(local_path):
            local_paths[filename] = local_path
            continue

        try:
            file_bytes = download_file(BUCKET_MODELS, storage_path)
            with open(local_path, "wb") as f:
                f.write(file_bytes)
            local_paths[filename] = local_path
            print(f"Downloaded: {filename}")
        except Exception as e:
            raise ValueError(f"Required file {filename} not found in Supabase: {e}")

    return local_paths


def get_model_urls(version_number: str) -> dict:
    """
    Get all public URLs for a model version from Supabase Storage.
    """
    urls = {}

    files = [
        ("tflite_url",        "sign_model_motion.tflite"),
        ("h5_url",            "sign_model_motion.h5"),
        ("labels_motion_url", "labels_motion.json"),
    ]

    for key, filename in files:
        try:
            url = get_public_url(BUCKET_MODELS, f"{version_number}/{filename}")
            urls[key] = url
        except Exception:
            urls[key] = None

    return urls


def deploy(version_number: str, model_id: int, tflite_url: str) -> dict:
    """
    Validate a version's immutable artifacts and return their URLs.

    The Node backend decides which version is active in one model_versions
    transaction. This service does not overwrite a shared deployed/ path.
    """
    print(f"\n{'='*50}")
    print(f"Deploying model version: {version_number}")
    print(f"{'='*50}\n")

    # ── Step 1: Verify model files exist in Supabase ──────────
    print("Verifying model files in Supabase...")
    try:
        local_paths = download_model_files(version_number)
    except ValueError as e:
        raise ValueError(f"Deployment failed — {e}")

    print(f"Verified {len(local_paths)} model files")

    model_urls = get_model_urls(version_number)

    print(f"\n{'='*50}")
    print(f"Validation complete for version: {version_number}")
    print(f"{'='*50}\n")

    return {
        "version_number": version_number,
        "model_id":       model_id,
        "status":         "validated",
        "versioned_urls": model_urls,
    }
