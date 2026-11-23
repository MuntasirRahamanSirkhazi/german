import html
import json
import re
import sqlite3
import zstandard
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACTED = ROOT / "_deck_extract"
COMPRESSED = EXTRACTED / "collection.anki21b"
DECODED = EXTRACTED / "collection.decoded.sqlite"
OUTPUT = ROOT / "dist" / "data" / "cards.json"


def decode_collection():
    EXTRACTED.mkdir(exist_ok=True)
    if not DECODED.exists() or DECODED.stat().st_mtime < COMPRESSED.stat().st_mtime:
        with COMPRESSED.open("rb") as source, DECODED.open("wb") as target:
            zstandard.ZstdDecompressor().copy_stream(source, target)


def clean(value):
    value = html.unescape(value or "")
    for _ in range(2):
        suspicious = sum(value.count(marker) for marker in ("Ã", "Â", "â", "ð"))
        if not suspicious:
            break
        try:
            repaired = value.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        repaired_suspicious = sum(repaired.count(marker) for marker in ("Ã", "Â", "â", "ð"))
        if repaired_suspicious >= suspicious:
            break
        value = repaired
    value = re.sub(r"<img[^>]*>", "", value, flags=re.I)
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(div|p|li|h[1-6])>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("\u00a0", " ").replace("\ufffd", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{2,}", "\n", value)
    return value.strip()


def first_sentence(value):
    value = clean(value)
    return value.split("\n")[0].strip()


def build_cards():
    decode_collection()
    connection = sqlite3.connect(DECODED)
    rows = connection.execute(
        "select id, flds from notes where mid = 1492015488846 order by id"
    ).fetchall()
    cards = []
    for index, (note_id, fields) in enumerate(rows, start=1):
        parts = (fields or "").split("\x1f")
        parts += [""] * (7 - len(parts))
        german, forms, german_sentence, rank, english, _not_this_word, english_sentence = parts[:7]
        german = clean(german)
        english = clean(english)
        if not german or not english:
            continue
        cards.append(
            {
                "id": str(note_id),
                "number": index,
                "german": german,
                "forms": clean(forms),
                "sentenceDe": first_sentence(german_sentence),
                "english": english,
                "sentenceEn": first_sentence(english_sentence),
                "rank": clean(rank),
            }
        )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(cards)} cards to {OUTPUT}")


if __name__ == "__main__":
    build_cards()
