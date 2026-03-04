import os
import json
from app.utils.supabase_client import (
    download_file,
    upload_file,
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

    files_to_download = [
        "sign_model_static.tflite",
        "sign_model_static.h5",
        "labels_static.json",
    ]

    # Optional motion model files
    optional_files = [
        "sign_model_motion.tflite",
        "sign_model_motion.h5",
        "labels_motion.json",
    ]

    local_paths = {}

    # Download required files
    for filename in files_to_download:
        storage_path = f"{version_number}/{filename}"
        local_path   = os.path.join(local_dir, filename)

        if os.path.exists(local_path):
            print(f"Already exists locally: {filename}")
            local_paths[filename] = local_path
            continue

        try:
            print(f"Downloading {filename}...")
            file_bytes = download_file(BUCKET_MODELS, storage_path)
            with open(local_path, "wb") as f:
                f.write(file_bytes)
            local_paths[filename] = local_path
            print(f"Downloaded: {filename}")
        except Exception as e:
            raise ValueError(f"Required file {filename} not found in Supabase: {e}")

    # Download optional files
    for filename in optional_files:
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
            print(f"Downloaded optional: {filename}")
        except Exception:
            print(f"Optional file not found, skipping: {filename}")

    return local_paths


def get_model_urls(version_number: str) -> dict:
    """
    Get all public URLs for a model version from Supabase Storage.
    """
    urls = {}

    files = [
        ("tflite_url",        "sign_model_static.tflite"),
        ("h5_url",            "sign_model_static.h5"),
        ("motion_tflite_url", "sign_model_motion.tflite"),
        ("motion_h5_url",     "sign_model_motion.h5"),
        ("labels_static_url", "labels_static.json"),
        ("labels_motion_url", "labels_motion.json"),
    ]

    for key, filename in files:
        try:
            url = get_public_url(BUCKET_MODELS, f"{version_number}/{filename}")
            urls[key] = url
        except Exception:
            urls[key] = None

    return urls


def copy_to_deployed_folder(version_number: str) -> dict:
    """
    Copy model files to a 'deployed/' folder in Supabase Storage.
    This makes it easy for the mobile app to always fetch from
    a fixed path: models/deployed/sign_model_static.tflite
    """
    files_to_copy = [
        "sign_model_static.tflite",
        "labels_static.json",
        "sign_model_motion.tflite",
        "labels_motion.json",
    ]

    deployed_urls = {}

    for filename in files_to_copy:
        source_path   = f"{version_number}/{filename}"
        deployed_path = f"deployed/{filename}"

        try:
            # Download from versioned folder
            file_bytes = download_file(BUCKET_MODELS, source_path)

            # Upload to deployed folder (overwrites previous)
            content_type = (
                "application/json"
                if filename.endswith(".json")
                else "application/octet-stream"
            )
            url = upload_file(BUCKET_MODELS, deployed_path, file_bytes, content_type)
            deployed_urls[filename] = url
            print(f"Copied {filename} to deployed folder")

        except Exception as e:
            print(f"Skipping {filename}: {e}")
            deployed_urls[filename] = None

    return deployed_urls


def deploy(version_number: str, model_id: int, tflite_url: str) -> dict:
    """
    Main deploy function.
    Downloads model files, copies to deployed/ folder in Supabase,
    returns deployed URLs.
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

    # ── Step 2: Copy files to deployed/ folder ────────────────
    print("\nCopying files to deployed/ folder in Supabase...")
    deployed_urls = copy_to_deployed_folder(version_number)

    # ── Step 3: Get all versioned URLs ────────────────────────
    model_urls = get_model_urls(version_number)

    print(f"\n{'='*50}")
    print(f"Deployment complete for version: {version_number}")
    print(f"{'='*50}\n")

    return {
        "version_number": version_number,
        "model_id":       model_id,
        "status":         "deployed",
        "versioned_urls": model_urls,
        "deployed_urls":  deployed_urls,
    }
# ```

# ---

# **What this file does step by step:**
# ```
# 1. Verify all required model files exist in Supabase Storage
# 2. Download them locally to confirm they are valid
# 3. Copy .tflite and label map files to deployed/ folder in Supabase
# 4. Return all URLs back to Node.js
# ```

# ---

# **Why the `deployed/` folder matters:**

# Instead of the mobile app needing to know which version is active, it always fetches from a fixed path:
# ```
# models/deployed/sign_model_static.tflite   ← always the latest
# models/deployed/labels_static.json
# models/deployed/sign_model_motion.tflite
# models/deployed/labels_motion.json