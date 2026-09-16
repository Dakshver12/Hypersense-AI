from pathlib import Path

import whisper

audio_path = Path(__file__).with_name("test.mp3")

if not audio_path.is_file():
    raise FileNotFoundError(f"Audio file not found: {audio_path}")

print("Loading Whisper...")
model = whisper.load_model("base", device="cpu")

print("Transcribing...")
result = model.transcribe(
    str(audio_path),
    fp16=False,
)

print("\nTranscribed answer:")
print(result["text"].strip())