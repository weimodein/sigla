import os
import tempfile
import httpx
import cv2
import numpy as np
from app.utils.supabase_client import upload_file, BUCKET_MODELS
from dotenv import load_dotenv

load_dotenv()

# Backend API configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000/api")
ML_API_KEY = os.getenv("ML_API_KEY")


def get_approved_samples_for_word(word_id: int) -> list:
    """
    Fetch approved sample image URLs for a specific word from backend.
    """
    if not ML_API_KEY:
        raise ValueError("ML_API_KEY not set")

    url = f"{BACKEND_URL}/ml/word-samples/{word_id}"
    headers = {"X-API-Key": ML_API_KEY}

    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()  # List of {file_url, ...}


def generate_word_video(word_id: int, word_label: str) -> str:
    """
    Generate a short demonstration video from approved gesture images.
    Returns public URL of the uploaded video.
    """
    print(f"Generating video for word: {word_label} (ID: {word_id})")

    # 1. Get approved sample image URLs
    samples = get_approved_samples_for_word(word_id)
    if not samples:
        raise ValueError(f"No approved samples found for word '{word_label}'")

    # Limit to first 30 images to keep video short
    image_urls = [s["file_url"] for s in samples[:30]]

    # 2. Download images to temporary files
    temp_dir = tempfile.mkdtemp()
    image_paths = []

    for idx, url in enumerate(image_urls):
        try:
            resp = httpx.get(url, timeout=10.0)
            resp.raise_for_status()
            path = os.path.join(temp_dir, f"frame_{idx:03d}.jpg")
            with open(path, "wb") as f:
                f.write(resp.content)
            image_paths.append(path)
        except Exception as e:
            print(f"Failed to download {url}: {e}")

    if not image_paths:
        raise ValueError("No images could be downloaded")

    # 3. Compile video using OpenCV
    first_img = cv2.imread(image_paths[0])
    if first_img is None:
        raise ValueError("Could not read first image")
    h, w, _ = first_img.shape

    video_path = os.path.join(temp_dir, f"{word_label}.mp4")
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, 1.0, (w, h))  # 1 fps

    for img_path in image_paths:
        frame = cv2.imread(img_path)
        if frame is not None:
            out.write(frame)
    out.release()

    # 4. Upload video to Supabase
    storage_path = f"word_videos/{word_id}_{word_label}.mp4"
    with open(video_path, "rb") as f:
        video_bytes = f.read()
    video_url = upload_file(BUCKET_MODELS, storage_path, video_bytes, "video/mp4")

    # 5. Cleanup
    for path in image_paths + [video_path]:
        os.remove(path)
    os.rmdir(temp_dir)

    print(f"Video generated and uploaded: {video_url}")
    return video_url