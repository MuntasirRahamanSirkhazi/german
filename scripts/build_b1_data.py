import json
import sqlite3
import zstandard
from pathlib import Path

from build_deck_data import clean

ROOT = Path(__file__).resolve().parents[1]
EXTRACTED = ROOT / "_b1_deck_extract"
COMPRESSED = EXTRACTED / "collection.anki21b"
DECODED = EXTRACTED / "collection.decoded.sqlite"
OUTPUT = ROOT / "dist" / "data" / "b1-cards.json"


def decode_collection():
    if not DECODED.exists() or DECODED.stat().st_mtime < COMPRESSED.stat().st_mtime:
        with COMPRESSED.open("rb") as source, DECODED.open("wb") as target:
            zstandard.ZstdDecompressor().copy_stream(source, target)


def first_pair(parts):
    for index in range(6, 24, 2):
        german_sentence = clean(parts[index])
        english_sentence = clean(parts[index + 1])
        if german_sentence:
            return german_sentence.split("\n")[0].strip(), english_sentence.split("\n")[0].strip()
    return "", ""


def build_cards():
    decode_collection()
    connection = sqlite3.connect(DECODED)
    rows = connection.execute(
        "select id, flds from notes where mid = 1516347233607"
    ).fetchall()
    parsed = []
    for note_id, fields in rows:
        parts = (fields or "").split("\x1f")
        parts += [""] * (35 - len(parts))
        full_d, base_e, base_d, article, plural = [clean(value) for value in parts[:5]]
        german = " ".join(value for value in (article, base_d) if value).strip() or full_d
        forms = full_d if full_d != german else (f"{article} {plural}".strip() if plural else "")
        sentence_de, sentence_en = first_pair(parts)
        if not german or not base_e:
            continue
        try:
            order = int(clean(parts[24]))
        except ValueError:
            order = 999999
        parsed.append((order, int(note_id), german, forms, sentence_de, sentence_en, base_e))

    parsed.sort(key=lambda item: (item[0], item[1]))
    cards = []
    for number, (_order, note_id, german, forms, sentence_de, sentence_en, english) in enumerate(parsed, start=1):
        cards.append(
            {
                "id": f"b1-{note_id}",
                "number": number,
                "german": german,
                "forms": forms,
                "sentenceDe": sentence_de,
                "english": english,
                "sentenceEn": sentence_en,
                "rank": "",
            }
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(cards)} B1 cards to {OUTPUT}")


if __name__ == "__main__":
    build_cards()
