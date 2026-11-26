"""Build a small, high-priority A2/B1 reference deck from the Goethe-5000 data."""

import argparse
import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "important-vocabulary.json"


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def pos_label(pos):
    pos = clean(pos)
    if pos in {"der", "die", "das", "der, die", "der, das", "die (pl)"}:
        return "Noun"
    return {
        "verb": "Verb",
        "adj": "Adjective",
        "adv": "Adverb",
        "pron": "Pronoun",
        "prep": "Preposition",
        "conj": "Conjunction",
        "part": "Particle",
        "particle": "Particle",
        "num": "Number",
        "phrase": "Phrase",
    }.get(pos, pos.title())


def to_card(row, level, position):
    word = clean(row.get("word"))
    article = clean(row.get("article"))
    german = " ".join(part for part in (article, word) if part)
    forms = [pos_label(row.get("pos"))]
    conjugation = clean(row.get("conjugation"))
    plural = clean(row.get("plural"))
    variants = clean(row.get("variants"))
    if conjugation:
        forms.append(conjugation.replace(" | ", " · "))
    elif plural:
        forms.append(f"Plural: {plural}")
    if variants:
        forms.append(f"also: {variants}")
    return {
        "id": f"important-{level.lower()}-{clean(row.get('id')) or position}",
        "level": level,
        "priority": position,
        "german": german,
        "forms": " · ".join(forms),
        "sentenceDe": clean(row.get("example_de")),
        "english": clean(row.get("english")),
        "sentenceEn": clean(row.get("example_en")),
        "rank": clean(row.get("rank")),
        "partOfSpeech": clean(row.get("pos")),
        "source": "goethe-5000",
    }


def build(source_path, a2_limit, b1_limit):
    with source_path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))

    cards = []
    for level, limit in (("A2", a2_limit), ("B1", b1_limit)):
        selected = [
            row for row in rows
            if clean(row.get("level")) == level
            and clean(row.get("source")) == "goethe-5000"
            and clean(row.get("word"))
            and clean(row.get("english"))
        ]
        selected.sort(key=lambda row: int(row.get("rank_in_level") or 999999))
        cards.extend(to_card(row, level, position) for position, row in enumerate(selected[:limit], start=1))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cards)} important cards to {OUTPUT} ({a2_limit} A2 + {b1_limit} B1)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to german_vocab_a1_c2.csv")
    parser.add_argument("--a2-limit", type=int, default=100)
    parser.add_argument("--b1-limit", type=int, default=100)
    args = parser.parse_args()
    build(args.source, args.a2_limit, args.b1_limit)
