"""Download the Piper voices used by Teevra into the ignored models directory."""
from pathlib import Path
from urllib.request import urlopen
import shutil

MODELS = Path(__file__).resolve().parent / "models" / "piper"
VOICES = {
    "hi_IN-pratham-medium": "https://huggingface.co/rhasspy/piper-voices/resolve/1af0d6b/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx",
    "en_IN-spicor": "https://huggingface.co/navgurukul-ai-labs/text-to-speech-en-IN-piper/resolve/a4ff93e/en_IN-dataset=spicor-english-base=ljspeech-epochs=1089.onnx",
}


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    for name, url in VOICES.items():
        for suffix in ("", ".json"):
            target = MODELS / f"{name}.onnx{suffix}"
            if target.exists():
                continue
            print(f"Downloading {target.name}...", flush=True)
            temporary = target.with_suffix(target.suffix + ".part")
            try:
                with urlopen(url + suffix, timeout=120) as response, temporary.open("wb") as output:
                    shutil.copyfileobj(response, output)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
