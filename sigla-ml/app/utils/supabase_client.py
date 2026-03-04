import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL         = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Buckets ───────────────────────────────────────────────────
BUCKET_GESTURES = os.getenv("SUPABASE_BUCKET_GESTURES", "gesture-samples")
BUCKET_MODELS   = os.getenv("SUPABASE_BUCKET_MODELS",   "model-files")


def upload_file(bucket: str, path: str, file_bytes: bytes, content_type: str = "application/octet-stream") -> str:
    """
    Upload a file to Supabase Storage.
    Returns the public URL of the uploaded file.
    """
    supabase.storage.from_(bucket).upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": content_type, "upsert": "true"}
    )

    url = supabase.storage.from_(bucket).get_public_url(path)
    return url


def download_file(bucket: str, path: str) -> bytes:
    """
    Download a file from Supabase Storage.
    Returns raw bytes.
    """
    response = supabase.storage.from_(bucket).download(path)
    return response


def list_files(bucket: str, folder: str = "") -> list:
    """
    List all files in a bucket folder.
    """
    response = supabase.storage.from_(bucket).list(folder)
    return response


def delete_file(bucket: str, path: str) -> None:
    """
    Delete a file from Supabase Storage.
    """
    supabase.storage.from_(bucket).remove([path])


def get_public_url(bucket: str, path: str) -> str:
    """
    Get the public URL of a file without downloading it.
    """
    return supabase.storage.from_(bucket).get_public_url(path)