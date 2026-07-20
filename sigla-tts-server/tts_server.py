from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
import edge_tts
import io

app = FastAPI()

VOICES = {
    "male": "en-US-GuyNeural",
    "female": "en-US-JennyNeural",
}

@app.get("/speak")
async def speak(text: str = Query(...), voice: str = Query("female")):
    voice_id = VOICES.get(voice.lower(), VOICES["female"])
    communicate = edge_tts.Communicate(text, voice_id)

    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]

    return StreamingResponse(
        io.BytesIO(audio_data),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"}
    )

@app.get("/health")
async def health():
    return {"status": "ok"}