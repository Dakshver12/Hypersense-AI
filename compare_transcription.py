"""Compare a supplied recording with the earlier HyperSense transcript.
Runs one Groq Whisper Large V3 request. Does not change HyperSense settings.
"""
import argparse
import json
import os
from pathlib import Path
from time import perf_counter

from dotenv import load_dotenv
from groq import Groq, APIConnectionError, APIStatusError

PREVIOUS_TRANSCRIPT = (
    "I would prefer it's not items because it is the idomic Python approach and "
    "the containers are falsely in Python, so it clearly expresses the intention "
    "of checking whether the container is empty, it is concise, readable and works "
    "with list as well as others standard containers such as couples, dictionaries, "
    "set, and strings."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recording', type=Path)
    args = parser.parse_args()
    if not args.recording.is_file():
        raise SystemExit('Recording not found. Supply the full path or put it beside this script.')
    load_dotenv(Path(__file__).with_name('.env'))
    key = os.getenv('GROQ_API_KEY', '').strip()
    if not key:
        raise SystemExit('Add GROQ_API_KEY to the .env beside this script. Do not share the key.')
    print('Uploading this recording to Groq for one transcription request...', flush=True)
    started = perf_counter()
    try:
        with Groq(api_key=key, timeout=120.0, max_retries=0) as client:
            with args.recording.open('rb') as audio:
                result = client.audio.transcriptions.create(
                    file=audio,
                    model='whisper-large-v3',
                    language='en',
                    temperature=0.0,
                    response_format='json',
                )
    except APIStatusError as exc:
        raise SystemExit(f'Groq returned HTTP {exc.status_code}. No comparison was completed.') from None
    except APIConnectionError:
        raise SystemExit('Could not connect to Groq. No comparison was completed.') from None
    text = result.text.strip()
    if not text:
        raise SystemExit('Groq returned no transcription.')
    report = {
        'recording': args.recording.name,
        'previous_transcript_supplied_by_user': PREVIOUS_TRANSCRIPT,
        'comparison_model': 'whisper-large-v3',
        'comparison_seconds': round(perf_counter() - started, 2),
        'comparison_text': text,
        'note': 'Compare both texts against playback. The previous transcript is not ground truth. No answer or expected wording was supplied to the model.',
    }
    # Unique file name: preserve previous comparison results.
    from datetime import datetime
    destination = Path(__file__).with_name('transcription-comparison-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.json')
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'\nSaved: {destination.name}')


if __name__ == '__main__':
    main()
