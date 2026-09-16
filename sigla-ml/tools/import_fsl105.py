"""
Trim-and-import the FSL-105 dataset into SIGLA's gesture_samples.

WHY THIS EXISTS
---------------
FSL-105 clips are uniformly ~4.07s at 60fps, but the SIGN occupies only the middle
of each take: measured across 10 random classes, 40% of a clip is leading dead time
(signer standing still before raising their hands) and 22% is trailing. That padding
is why raw FSL-105 clips are rejected by extract.py at a rate of ~11 in 12 — not
because the signing is poor. Hand density INSIDE the signing span is 96%.

So this tool trims each clip to its signing span before extraction. The trim is not
cosmetic: extract.py deliberately refuses clips with a long hands-less run, because
the phone ends a gesture after NO_HAND_TIMEOUT and could never classify a window
containing one. Trimming removes dead air that the recording simply does not need,
rather than relaxing a gate that exists for a reason.

WHAT IT DOES, PER CLIP
    1. Sample the clip and find the first/last frame with a detected hand.
    2. Re-encode just that span (plus a small pad) to a temp .mp4.
    3. Run the real extract_motion_landmarks on it — the SAME function the
       /extract-landmarks endpoint calls, so a clip that passes here passes there.
    4. POST the trimmed VIDEO to /words/:id/upload-videos with a session_id
       derived from the signer folder, so the sample is stored by exactly the
       same server-side path as a manual admin upload.

SIGNER IDS
    organized_clips/<class>/signer-NN/<n>.MOV

    signer-01 IS THE SAME PERSON across every class — confirmed by the dataset
    owner (2026-09-01). The default is therefore --signer-scope=global, which
    writes the folder name ("signer-01") straight through, so prepare_motion_dataset
    can hold out one real person across all 105 classes and report a genuine
    new-signer accuracy.

    Note this contradicts what raw image statistics suggested: the four folders
    cluster WITHIN a class (between/within distance ratio 1.35-1.68) but showed no
    separation ACROSS classes (747-821 within vs 820 between). That is explained by
    背景/lighting varying per recording session rather than per person — appearance
    statistics are simply not a reliable identity signal here. The owner's
    attribution wins; do not "correct" this back based on pixel distances.

    --signer-scope=class is kept as the conservative fallback. It writes
    "c31-signer-01", making each class's signers their own groups, which is the
    right choice for any FUTURE dataset whose provenance is unknown. It weakens the
    grouped estimate (a held-out "signer" covers only one word), so do not use it
    for FSL-105.

USAGE
    # See what would happen — no DB writes, no backend calls:
    venv/Scripts/python.exe tools/import_fsl105.py --dry-run

    # Only the classes that map to existing SIGLA words:
    venv/Scripts/python.exe tools/import_fsl105.py --dry-run --only-existing-words

    # Actually import (requires the backend running and an admin token):
    venv/Scripts/python.exe tools/import_fsl105.py --token "$ADMIN_JWT"
"""

import argparse
import csv
import json
import os
import sys
import tempfile
from collections import defaultdict

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.extract import (  # noqa: E402
    ExtractionQualityError,
    _detect,
    _make_landmarker,
    extract_motion_landmarks,
)

DEFAULT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "datasets", "organized_clips")
)
DEFAULT_LABELS = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "datasets",
        "FSL-105 A dataset for recognizing 105 Filipino sign language videos",
        "labels.csv",
    )
)

VIDEO_EXTS = (".mov", ".mp4", ".webm", ".avi", ".mkv")

# Frames sampled when locating the signing span. Independent of extract.py's own
# budget: this is a coarse scan, and a finer one costs detection time for no gain.
SCAN_FRAMES = 60

# Real frames of padding kept on each side of the detected span. Enough to retain
# the start of the raise and the end of the lower, which carry gesture velocity,
# without re-admitting the long static stretch.
TRIM_PAD_FRAMES = 4


def normalize_label(label: str) -> str:
    """Mirror the backend's normalizeLabel so lookups agree."""
    out = []
    for ch in label.lower():
        if ch.isalnum() or ch.isspace() or ch == "_":
            out.append(ch)
    return "".join(out).strip()


def load_label_map(labels_csv: str) -> dict:
    """class-id (str) -> label, from FSL-105's labels.csv."""
    mapping = {}
    with open(labels_csv, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            cid = (row.get("id") or "").strip()
            label = (row.get("label") or "").strip()
            if cid and label:
                mapping[cid] = label
    return mapping


def load_category_map(labels_csv: str) -> dict:
    """class-id (str) -> category name, from FSL-105's labels.csv."""
    mapping = {}
    with open(labels_csv, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            cid = (row.get("id") or "").strip()
            cat = (row.get("category") or "").strip()
            if cid and cat:
                mapping[cid] = cat
    return mapping


def find_signing_span(path: str, landmarker) -> tuple[int, int, int] | None:
    """
    Locate the first and last frame index containing a detected hand.

    Returns (start, end, total_frames), or None when no hand is found anywhere.
    Indices are into the ORIGINAL clip, already padded by TRIM_PAD_FRAMES.
    """
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total < 1:
            return None
        idxs = np.linspace(0, total - 1, min(total, SCAN_FRAMES), dtype=int)
        hits = []
        for i in idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, frame = cap.read()
            if not ok:
                continue
            if _detect(landmarker, frame).hand_landmarks:
                hits.append(int(i))
        if not hits:
            return None
        start = max(hits[0] - TRIM_PAD_FRAMES, 0)
        end = min(hits[-1] + TRIM_PAD_FRAMES, total - 1)
        return start, end, total
    finally:
        cap.release()


def write_trimmed(path: str, start: int, end: int, out_path: str) -> bool:
    """Re-encode frames [start, end] of `path` into `out_path`. True on success."""
    cap = cv2.VideoCapture(path)
    writer = None
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not np.isfinite(fps) or fps <= 1.0:
            fps = 30.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if w <= 0 or h <= 0:
            return False
        writer = cv2.VideoWriter(
            out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)
        )
        if not writer.isOpened():
            return False
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(start))
        written = 0
        for _ in range(int(end - start + 1)):
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(frame)
            written += 1
        return written > 0
    finally:
        if writer is not None:
            writer.release()
        cap.release()


def _unlink(path: str) -> None:
    """Best-effort temp-file cleanup; a leftover temp must never fail an import."""
    try:
        os.unlink(path)
    except OSError:
        pass


def detect_layout(root: str) -> str:
    """
    Decide whether `root` is nested <class>/<signer>/ or <signer>/<class>/.

    Getting this wrong is silent and destructive: the two levels are just directory
    names, so reading a signer/class tree as class/signer yields "class signer-01"
    containing "signer 0".."9". Every clip still imports, but session_id becomes the
    CLASS and the label becomes the SIGNER — the grouped split then holds out a word
    instead of a person, and the new-signer accuracy number is meaningless.

    Detection keys on the "signer-" prefix that both layouts use for the signer level
    (it is also what session_id_for writes through). Class directories are numeric
    ids from labels.csv, so the two are unambiguous in practice.

    Returns "class_first" or "signer_first"; raises if the tree matches neither, so
    an unexpected layout fails loudly rather than being guessed at.
    """
    top = [d for d in sorted(os.listdir(root))
           if os.path.isdir(os.path.join(root, d))]
    if not top:
        raise ValueError(f"no subdirectories under {root}")

    def looks_like_signer(name: str) -> bool:
        return name.lower().startswith("signer")

    top_signers = sum(1 for d in top if looks_like_signer(d))
    if top_signers == len(top):
        return "signer_first"
    if top_signers == 0:
        # Confirm the SECOND level is signers before declaring class-first, so a
        # tree that is neither shape is rejected rather than defaulted.
        for d in top:
            second = [x for x in os.listdir(os.path.join(root, d))
                      if os.path.isdir(os.path.join(root, d, x))]
            if second and all(looks_like_signer(x) for x in second):
                return "class_first"
        raise ValueError(
            f"{root}: top level is not signer-* and the second level is not either. "
            "Expected <class>/<signer-NN>/ or <signer-NN>/<class>/."
        )
    raise ValueError(
        f"{root}: top level mixes signer-* and non-signer directories "
        f"({top_signers}/{len(top)} look like signers) — cannot determine layout. "
        "Pass --layout explicitly."
    )


def iter_clips(root: str, layout: str = "class_first"):
    """
    Yield (class_id, signer, path) for every video under `root`.

    `layout` selects the on-disk nesting:
      * "class_first"  — root/<class>/<signer>/   (organized_clips, FSL-105 import)
      * "signer_first" — root/<signer>/<class>/   (the re-recorded capture layout)

    Both yield the SAME (cls, signer, path) tuple, so everything downstream —
    session_id_for, the per-class report, --save-trimmed — is layout-agnostic.
    """
    if layout not in ("class_first", "signer_first"):
        raise ValueError(f"unknown layout {layout!r}")

    for outer in sorted(os.listdir(root), key=lambda x: (len(x), x)):
        outer_dir = os.path.join(root, outer)
        if not os.path.isdir(outer_dir):
            continue
        for inner in sorted(os.listdir(outer_dir)):
            inner_dir = os.path.join(outer_dir, inner)
            if not os.path.isdir(inner_dir):
                continue
            cls, signer = (
                (outer, inner) if layout == "class_first" else (inner, outer)
            )
            for name in sorted(os.listdir(inner_dir)):
                if name.lower().endswith(VIDEO_EXTS):
                    yield cls, signer, os.path.join(inner_dir, name)


def session_id_for(cls: str, signer: str, scope: str) -> str:
    """Grouping key written to gesture_samples.session_id."""
    return signer if scope == "global" else f"c{cls}-{signer}"


def fetch_word_index(backend: str, token: str) -> dict:
    """normalized label -> word id, from the admin word list."""
    import httpx

    with httpx.Client(timeout=60.0) as client:
        r = client.get(
            f"{backend}/words",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": 1000},
        )
        r.raise_for_status()
        body = r.json()
    rows = body if isinstance(body, list) else (body.get("words") or body.get("data") or [])
    index = {}
    for row in rows:
        label = row.get("label")
        wid = row.get("id")
        if label and wid is not None:
            index[normalize_label(label)] = wid
    return index


def create_word(backend: str, token: str, label: str, category: str | None) -> tuple[int | None, str]:
    """
    Create one word via POST /words/admin-add. Returns (word_id, detail).

    Needed because the word bank can be empty: samples attach to a word_id, so a
    label with no row has nowhere to go. The route creates the word as
    status=approved / is_active=false — it only goes active once a deployed model
    is trained on its samples, so creating words here cannot put anything live.

    A 409 means the label already exists; that is a success for our purposes, and
    the caller re-reads the index to pick up the id.
    """
    import httpx

    payload = {
        "label": label,
        # The model hard-validates sign_type against exactly ["FSL"].
        "sign_type": "FSL",
        "category": category or None,
        "description": f"Imported from FSL-105 ({category})" if category else
                       "Imported from FSL-105",
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            r = client.post(
                f"{backend}/words/admin-add",
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
                content=json.dumps(payload),
            )
        if r.status_code == 409:
            body = r.json()
            return body.get("word_id"), "already exists"
        if r.status_code >= 400:
            return None, f"HTTP {r.status_code}: {r.text[:160]}"
        body = r.json()
        return (body.get("word") or {}).get("id"), "created"
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def post_clips_batch(backend: str, token: str, word_id: int,
                     video_paths: list, session_id: str) -> tuple[int, str]:
    """
    Upload MANY trimmed clips for one word in a SINGLE request.

    This must be one request, not a loop. /words/:id/upload-videos creates an
    UploadJob row and returns 202 immediately, then extracts in the background —
    and it refuses with 409 while a job for that word is still processing. Sending
    clips one at a time therefore stores only the first and rejects the rest:
    measured on the HELLO smoke test, 4 of 20 stored and 16 came back
    "an upload job is already processing for this word".
    
    The route's multer config accepts up to 50 files per request
    (videoUpload.array("videos", 50)), which covers a full FSL-105 class (~20).
    Returns (count_submitted, detail).
    """
    import httpx

    if not video_paths:
        return 0, "nothing to upload"
    # Hard cap from the route's multer config; chunk above it.
    MAX_FILES = 50
    if len(video_paths) > MAX_FILES:
        return -1, f"too many files for one request ({len(video_paths)} > {MAX_FILES})"

    handles = []
    try:
        files = []
        for vp in video_paths:
            fh = open(vp, "rb")
            handles.append(fh)
            files.append(("videos", (os.path.basename(vp), fh, "video/mp4")))
        with httpx.Client(timeout=600.0) as client:
            r = client.post(
                f"{backend}/words/{word_id}/upload-videos",
                headers={"Authorization": f"Bearer {token}"},
                files=files,
                data={"session_id": session_id},
            )
        if r.status_code == 409:
            return 0, "an upload job is already processing for this word"
        if r.status_code >= 400:
            return 0, f"HTTP {r.status_code}: {r.text[:200]}"
        return len(video_paths), "accepted"
    except Exception as e:  # noqa: BLE001
        return 0, str(e)
    finally:
        for fh in handles:
            try:
                fh.close()
            except OSError:
                pass


def wait_for_upload_job(backend: str, token: str, word_id: int,
                        timeout_s: float = 900.0) -> str:
    """
    Block until no upload job is processing for this word.

    Required between words as well as within one: the 409 guard is per word, but
    a slow job also means approved_sample_count is still climbing, and the next
    word's request should not queue behind an unfinished one.
    """
    import time

    import httpx

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.get(
                    f"{backend}/words/{word_id}/upload-jobs/active",
                    headers={"Authorization": f"Bearer {token}"},
                )
            if r.status_code == 404:
                return "done"
            body = r.json() if r.status_code < 400 else {}
            job = body.get("job") or body
            if not job or job.get("status") != "processing":
                return "done"
        except Exception:  # noqa: BLE001
            return "unknown"
        time.sleep(5)
    return "timeout"


def post_clip(backend: str, token: str, word_id: int, video_path: str,
              session_id: str) -> tuple[bool, str]:
    """
    Upload one TRIMMED clip to POST /words/:id/upload-videos.

    Deliberately posts the video rather than the sequence we already extracted.
    That route is the only one that stores a motion sequence with a session_id:
    /admin-samples takes base64 STILL IMAGES and would create image rows with no
    sequence at all. Re-extracting server-side also guarantees the stored sample
    came from the same code path as every manual upload, instead of trusting a
    sequence this tool computed out-of-band.

    The route answers 202 and processes in the background, so a 202 here means
    "accepted", not "stored" — the caller reports it as submitted and the per-word
    counters are the authority afterwards.
    """
    import httpx

    try:
        with open(video_path, "rb") as fh:
            files = {"videos": (os.path.basename(video_path), fh, "video/mp4")}
            data = {"session_id": session_id}
            with httpx.Client(timeout=300.0) as client:
                r = client.post(
                    f"{backend}/words/{word_id}/upload-videos",
                    headers={"Authorization": f"Bearer {token}"},
                    files=files,
                    data=data,
                )
        if r.status_code == 409:
            return False, "an upload job is already processing for this word"
        if r.status_code >= 400:
            return False, f"HTTP {r.status_code}: {r.text[:200]}"
        return True, "accepted"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def _process_one(job: tuple) -> dict:
    """
    Trim + pre-flight ONE clip. Runs in a worker process.

    Each worker builds its own landmarker: MediaPipe graphs are not shareable
    across processes, and building one costs ~0.3s against ~27s of detection, so
    per-clip construction is not worth pooling around.

    Returns a plain dict (picklable) describing the outcome; the parent does all
    aggregation and all network I/O, so workers stay pure CPU.
    """
    cls, signer, path, tmpdir, keep_trimmed, save_dir = job
    out = {"cls": cls, "signer": signer, "path": path, "trimmed": None,
           "saved": None}
    try:
        with _make_landmarker() as landmarker:
            span = find_signing_span(path, landmarker)
        if span is None:
            out["status"] = "no_hand"
            out["reason"] = "no hand detected anywhere"
            return out
        start, end, _total = span

        if save_dir:
            # Mirror the source layout so a saved tree can be diffed against the
            # original and re-fed to this tool with --root.
            dest_dir = os.path.join(save_dir, cls, signer)
            os.makedirs(dest_dir, exist_ok=True)
            stem = os.path.splitext(os.path.basename(path))[0]
            trimmed = os.path.join(dest_dir, f"{stem}.mp4")
        else:
            trimmed = os.path.join(tmpdir, f"{cls}_{signer}_{os.path.basename(path)}.mp4")
        if not write_trimmed(path, start, end, trimmed):
            out["status"] = "trim_failed"
            out["reason"] = "re-encode failed"
            return out

        try:
            with open(trimmed, "rb") as f:
                sequence = extract_motion_landmarks(f.read(), os.path.basename(trimmed))
        except ExtractionQualityError as e:
            _unlink(trimmed)
            out["status"] = "rejected"
            out["reason"] = str(e).split(";")[0][:60]
            return out
        except Exception as e:  # noqa: BLE001
            _unlink(trimmed)
            out["status"] = "rejected"
            out["reason"] = f"extract error: {type(e).__name__}"
            return out

        if sequence is None:
            _unlink(trimmed)
            out["status"] = "rejected"
            out["reason"] = "extractor returned None"
            return out

        out["status"] = "accepted"
        if save_dir:
            # Durable: never unlinked by anyone.
            out["saved"] = trimmed
            if keep_trimmed:
                out["trimmed"] = trimmed
        elif keep_trimmed:
            out["trimmed"] = trimmed          # parent uploads, then unlinks
        else:
            _unlink(trimmed)
        return out
    except Exception as e:  # noqa: BLE001
        out["status"] = "rejected"
        out["reason"] = f"worker error: {type(e).__name__}: {e}"
        return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=DEFAULT_ROOT,
                    help="organized_clips directory (class/signer-NN/*.MOV)")
    ap.add_argument("--labels", default=DEFAULT_LABELS,
                    help="FSL-105 labels.csv, for class-id -> label")
    ap.add_argument("--layout", choices=("auto", "class_first", "signer_first"),
                    default="auto",
                    help="on-disk nesting: 'class_first' is <class>/<signer-NN>/ "
                         "(organized_clips), 'signer_first' is <signer-NN>/<class>/ "
                         "(the re-recorded capture layout). 'auto' (default) detects "
                         "it from the directory names and fails loudly if the tree "
                         "matches neither — reading one layout as the other silently "
                         "swaps label and session_id.")
    ap.add_argument("--signer-scope", choices=("class", "global"), default="global",
                    help="'global' (default, correct for FSL-105) writes signer-NN: "
                         "the ids track the same person across every class, so the "
                         "grouped split holds out one real signer. 'class' writes "
                         "c<cls>-signer-NN — the conservative choice for a dataset "
                         "whose provenance is unknown; it weakens the estimate.")
    ap.add_argument("--dry-run", action="store_true",
                    help="extract and report, but never call the backend")
    ap.add_argument("--create-words", action="store_true",
                    help="create any FSL-105 label that has no word row yet "
                         "(POST /words/admin-add, sign_type=FSL, category from "
                         "labels.csv). Words are created approved-but-INACTIVE; "
                         "activation still requires a deployed model trained on "
                         "their samples. Opt-in so an import cannot add rows to the "
                         "word bank as a side effect.")
    ap.add_argument("--only-existing-words", action="store_true",
                    help="skip FSL-105 classes with no matching SIGLA word")
    ap.add_argument("--limit-per-class", type=int, default=0,
                    help="cap clips processed per class (0 = all); for a fast probe")
    ap.add_argument("--classes", default=None,
                    help="comma-separated class ids to process (default: all)")
    ap.add_argument("--backend", default=os.getenv("BACKEND_URL", "http://localhost:3000/api"))
    ap.add_argument("--token", default=os.getenv("ADMIN_JWT"),
                    help="admin JWT; required unless --dry-run")
    ap.add_argument("--save-trimmed", default=None, metavar="DIR",
                    help="write the trimmed clips to DIR, mirroring the source "
                         "layout (DIR/<class>/<signer>/<name>.mp4), and KEEP them. "
                         "Without this the trimmed video is a throwaway intermediate: "
                         "it is deleted the moment its sequence has been extracted or "
                         "uploaded. Use it to eyeball the trims before trusting them, "
                         "or to avoid re-paying ~28s of CPU per clip on a re-run.")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2),
                    help="parallel worker processes for trim+extract (default: "
                         "cores-2). Trim+extract is ~28s of CPU per clip, so this "
                         "is the difference between ~17h and ~3h on 2130 clips. "
                         "Uploads still happen serially in the parent.")
    ap.add_argument("--out", default=None, help="write the per-class report as JSON")
    args = ap.parse_args()

    if not os.path.isdir(args.root):
        print(f"organized_clips not found: {args.root}")
        return 1
    if not args.dry_run and not args.token:
        print("--token (or ADMIN_JWT) is required unless --dry-run")
        return 1

    labels = load_label_map(args.labels) if os.path.isfile(args.labels) else {}
    if not labels:
        print(f"[warn] no labels loaded from {args.labels}; classes report as ids only")
    categories = load_category_map(args.labels) if os.path.isfile(args.labels) else {}

    word_index = {}
    if not args.dry_run or args.only_existing_words:
        if not args.token:
            print("--only-existing-words needs --token to read the word list")
            return 1
        try:
            word_index = fetch_word_index(args.backend, args.token)
            print(f"[import] {len(word_index)} existing words in the word bank")
        except Exception as e:  # noqa: BLE001
            print(f"[import] could not read the word list: {e}")
            return 1

        # Create any missing words FIRST, so every clip has somewhere to attach.
        # Opt-in: creating rows in the word bank is a visible change to the admin
        # UI, and it must never happen as a side effect of an import someone
        # thought was only uploading samples.
        if args.create_words and not args.dry_run:
            wanted_now = None
            if args.classes:
                wanted_now = {c.strip() for c in args.classes.split(",") if c.strip()}
            missing = []
            for cls, label in sorted(labels.items(), key=lambda kv: int(kv[0])):
                if wanted_now is not None and cls not in wanted_now:
                    continue
                if normalize_label(label) not in word_index:
                    missing.append((cls, label))
            if missing:
                print(f"[import] creating {len(missing)} missing word(s) ...")
                created = failed = 0
                for cls, label in missing:
                    wid, detail = create_word(
                        args.backend, args.token, label, categories.get(cls)
                    )
                    if wid is not None:
                        word_index[normalize_label(label)] = wid
                        created += 1
                    else:
                        failed += 1
                        print(f"[import]   FAILED {label!r}: {detail}")
                print(f"[import] words created: {created}, failed: {failed}")
                if failed:
                    print("[import] refusing to continue with missing words — "
                          "their clips would be silently skipped.")
                    return 1

    wanted = None
    if args.classes:
        wanted = {c.strip() for c in args.classes.split(",") if c.strip()}

    # class id -> counters
    stats = defaultdict(lambda: {
        "label": None, "word_id": None, "total": 0, "accepted": 0,
        "no_hand": 0, "trim_failed": 0, "rejected": 0, "stored": 0,
        "store_failed": 0, "reasons": defaultdict(int),
        "signers": defaultdict(int),
    })

    tmpdir = tempfile.mkdtemp(prefix="fsl105_")

    # Build the work list first so the pool has something to chew on and the
    # per-class caps are applied deterministically rather than by arrival order.
    jobs = []
    per_class_seen = defaultdict(int)
    layout = detect_layout(args.root) if args.layout == "auto" else args.layout
    print(f"[import] source layout: {layout} "
          f"({'<class>/<signer>' if layout == 'class_first' else '<signer>/<class>'})")

    for cls, signer, path in iter_clips(args.root, layout):
        if wanted is not None and cls not in wanted:
            continue
        if args.limit_per_class and per_class_seen[cls] >= args.limit_per_class:
            continue
        per_class_seen[cls] += 1

        st = stats[cls]
        st["label"] = labels.get(cls, f"<class {cls}>")
        st["total"] += 1

        if word_index:
            wid = word_index.get(normalize_label(st["label"]))
            st["word_id"] = wid
            if args.only_existing_words and wid is None:
                st["reasons"]["no matching SIGLA word"] += 1
                continue

        jobs.append((cls, signer, path, tmpdir, not args.dry_run, args.save_trimmed))

    total_jobs = len(jobs)
    print(f"[import] {total_jobs} clip(s) queued across {len(stats)} class(es); "
          f"workers={args.workers}")

    # Trim + extract is ~28s of pure CPU per clip (8.8s scan + 18.6s extract), so a
    # serial pass over 2130 clips is ~17 hours. MediaPipe releases the GIL poorly
    # and its graphs are not shareable, so PROCESSES rather than threads.
    processed = 0
    results = []
    if args.workers > 1:
        import multiprocessing as mp

        ctx = mp.get_context("spawn")
        with ctx.Pool(processes=args.workers) as pool:
            for res in pool.imap_unordered(_process_one, jobs, chunksize=1):
                results.append(res)
                processed += 1
                if processed % 25 == 0 or processed == total_jobs:
                    print(f"[import] {processed}/{total_jobs} clips processed ...",
                          flush=True)
    else:
        for job in jobs:
            results.append(_process_one(job))
            processed += 1
            if processed % 25 == 0 or processed == total_jobs:
                print(f"[import] {processed}/{total_jobs} clips processed ...",
                      flush=True)

    # Aggregate + upload in the PARENT. Workers stay pure CPU: network I/O here
    # keeps the 409 "job already processing" serialization per word intact, which
    # concurrent uploads would trip over.
    #
    # Uploads are BATCHED, not per-clip: (class, session_id) -> [(path, saved)].
    pending_uploads = defaultdict(list)
    for res in results:
        cls = res["cls"]
        st = stats[cls]
        status = res["status"]

        if status == "accepted":
            st["accepted"] += 1
            st["signers"][res["signer"]] += 1
        elif status == "no_hand":
            st["no_hand"] += 1
            st["reasons"][res["reason"]] += 1
            continue
        elif status == "trim_failed":
            st["trim_failed"] += 1
            st["reasons"][res["reason"]] += 1
            continue
        else:
            st["rejected"] += 1
            st["reasons"][res["reason"]] += 1
            continue

        trimmed = res.get("trimmed")
        # A --save-trimmed file is durable output, never a temp file. Guard every
        # cleanup path on this, or the flag would silently delete what it promised
        # to keep.
        saved = bool(res.get("saved"))

        if args.dry_run:
            if trimmed and not saved:
                _unlink(trimmed)
            continue

        word_id = st.get("word_id")
        if word_id is None:
            st["store_failed"] += 1
            st["reasons"]["no matching SIGLA word"] += 1
            if trimmed and not saved:
                _unlink(trimmed)
            continue

        # Defer the upload: collect per (class, signer) so each session_id becomes
        # ONE batched request. See post_clips_batch for why per-clip requests lose
        # all but the first.
        sid = session_id_for(cls, res["signer"], args.signer_scope)
        pending_uploads[(cls, sid)].append((trimmed, saved))

    # ── Batched upload phase ──────────────────────────────────────────────────
    # One request per (word, session_id), waiting for each word's background job
    # to finish before the next request for that word. session_id is a per-request
    # field, so a word with 4 signers needs 4 sequential requests.
    if not args.dry_run and pending_uploads:
        groups = sorted(pending_uploads.items(), key=lambda kv: (int(kv[0][0]), kv[0][1]))
        print(f"[import] uploading {len(groups)} batch(es) ...")
        for (cls, sid), items in groups:
            st = stats[cls]
            word_id = st.get("word_id")
            paths = [p for p, _ in items]
            if word_id is None:
                st["store_failed"] += len(paths)
                st["reasons"]["no matching SIGLA word"] += len(paths)
                for p, was_saved in items:
                    if not was_saved:
                        _unlink(p)
                continue

            # Wait out any job still running for this word before adding another.
            wait_for_upload_job(args.backend, args.token, word_id)
            n, detail = post_clips_batch(args.backend, args.token, word_id, paths, sid)
            if n > 0:
                st["stored"] += n
                print(f"[import]   {st['label'][:24]:<24} {sid:<12} "
                      f"{n} clip(s) submitted")
            else:
                st["store_failed"] += len(paths)
                st["reasons"][f"store: {detail[:60]}"] += len(paths)
                print(f"[import]   {st['label'][:24]:<24} {sid:<12} FAILED: {detail[:60]}")
            # Let this word's job drain so approved_sample_count is settled and the
            # next batch for the same word is not refused with 409.
            wait_for_upload_job(args.backend, args.token, word_id)
            for p, was_saved in items:
                if not was_saved:
                    _unlink(p)

    report(stats, args)

    if args.out:
        serializable = {
            cls: {
                **{k: v for k, v in st.items() if k not in ("reasons", "signers")},
                "reasons": dict(st["reasons"]),
                "signers": dict(st["signers"]),
            }
            for cls, st in stats.items()
        }
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(serializable, f, indent=2)
        print(f"\n[import] report written to {args.out}")

    return 0


def report(stats: dict, args) -> None:
    """Per-class accept counts plus the gate verdict each class would receive."""
    from app.utils.preprocessor import (
        MIN_REAL_SAMPLES_PER_CLASS,
        MIN_SAMPLES_PER_SIGNER,
        MIN_SIGNERS_PER_CLASS,
    )

    total = sum(s["total"] for s in stats.values())
    accepted = sum(s["accepted"] for s in stats.values())
    stored = sum(s["stored"] for s in stats.values())

    print("\n" + "=" * 78)
    print(f"FSL-105 import report  ({'DRY RUN' if args.dry_run else 'LIVE'}, "
          f"signer-scope={args.signer_scope})")
    print("=" * 78)
    print(f"clips seen: {total}   extracted OK: {accepted} "
          f"({100 * accepted / max(total, 1):.0f}%)   stored: {stored}")
    print()
    print(f"Training gate: >={MIN_REAL_SAMPLES_PER_CLASS} clips, "
          f">={MIN_SIGNERS_PER_CLASS} signers with >={MIN_SAMPLES_PER_SIGNER} clips each")
    print()

    # Under --limit-per-class the sampled count is NOT the gate answer: a class
    # capped at 5 can never reach MIN_REAL_SAMPLES_PER_CLASS (20), so a naive
    # comparison marks all 105 as failing and says nothing. Project instead:
    # measure the acceptance RATE on the sample and apply it to the class's real
    # source-clip count, which is what a full import would actually produce.
    sampled = bool(args.limit_per_class)
    if sampled:
        print(f"NOTE: --limit-per-class {args.limit_per_class} — each class was "
              "sampled, not fully processed.")
        print("      Verdicts below are PROJECTED: (sample accept rate) x "
              "(source clips in that class).")
        print("      A projection near the threshold is a hint, not a decision — "
              "re-run that class in full.")
        print()

    source_counts = {}
    if sampled:
        for cls in stats:
            cls_dir = os.path.join(args.root, cls)
            n = 0
            if os.path.isdir(cls_dir):
                for signer in os.listdir(cls_dir):
                    sd = os.path.join(cls_dir, signer)
                    if os.path.isdir(sd):
                        n += len([f for f in os.listdir(sd)
                                  if f.lower().endswith(VIDEO_EXTS)])
            source_counts[cls] = n

    passing, failing = [], []
    for cls, st in stats.items():
        qualified = sum(1 for n in st["signers"].values() if n >= MIN_SAMPLES_PER_SIGNER)
        if sampled:
            rate = st["accepted"] / max(st["total"], 1)
            projected = int(rate * source_counts.get(cls, 0))
            # Signer coverage is NOT judged here: a 5-clip sample touches only one
            # or two signer folders, so any qualified-signer count from it would be
            # meaningless. Only the clip-count half of the gate is projected.
            ok = projected >= MIN_REAL_SAMPLES_PER_CLASS
            st["_projected"] = projected
            st["_rate"] = rate
        else:
            projected = st["accepted"]
            ok = (st["accepted"] >= MIN_REAL_SAMPLES_PER_CLASS
                  and qualified >= MIN_SIGNERS_PER_CLASS)
        (passing if ok else failing).append((cls, st, qualified))

    head_p = "WOULD PASS (projected)" if sampled else "WOULD PASS the gate"
    head_f = "WOULD FAIL (projected)" if sampled else "WOULD FAIL the gate"
    print(f"{head_p}: {len(passing)} class(es)")
    print(f"{head_f}: {len(failing)} class(es)")

    if failing:
        print("\nFailing classes:")
        for cls, st, qualified in sorted(
            failing, key=lambda x: (x[1].get("_projected", x[1]["accepted"]), x[0])
        ):
            top = sorted(st["reasons"].items(), key=lambda kv: -kv[1])[:1]
            why = f"  top reason: {top[0][0]} x{top[0][1]}" if top else ""
            if sampled:
                print(f"  {cls:>3} {st['label'][:24]:<24} "
                      f"sample {st['accepted']}/{st['total']} "
                      f"({100 * st.get('_rate', 0):.0f}%) -> ~{st.get('_projected', 0)}"
                      f"/{source_counts.get(cls, 0)} projected{why}")
            else:
                print(f"  {cls:>3} {st['label'][:26]:<26} "
                      f"{st['accepted']:>3}/{st['total']:<3} clips, "
                      f"{qualified} signer(s){why}")

    # Classes that clear the gate but not by much are the ones worth re-running in
    # full before trusting: a projection is a point estimate off a handful of clips.
    if sampled:
        margin = [(cls, st) for cls, st, _ in passing
                  if st.get("_projected", 0) < MIN_REAL_SAMPLES_PER_CLASS + 3]
        if margin:
            print(f"\nProjected to pass but within 3 of the threshold "
                  f"({len(margin)}) — verify these in a full run:")
            for cls, st in sorted(margin, key=lambda x: x[1].get("_projected", 0)):
                print(f"  {cls:>3} {st['label'][:24]:<24} "
                      f"~{st.get('_projected', 0)}/{source_counts.get(cls, 0)}")

    reasons = defaultdict(int)
    for st in stats.values():
        for k, v in st["reasons"].items():
            reasons[k] += v
    if reasons:
        print("\nRejection reasons across all classes:")
        for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])[:12]:
            print(f"  {v:>5}  {k}")


if __name__ == "__main__":
    raise SystemExit(main())
