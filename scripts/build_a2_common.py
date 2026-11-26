"""Merge the common Goethe-5000 A2 vocabulary into the app's A2 deck.

The source CSV is downloaded separately because it is a derived public dataset.
Run this script with the CSV path when refreshing the deck:

    python scripts/build_a2_common.py C:\\path\\to\\german_vocab_a1_c2.csv
"""

import argparse
import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "cards.json"
SOURCE_URL = "https://github.com/hasharmujahid/deutsch-karten"
ARTICLES = r"(?:der|die|das|ein|eine|einen|einem|einer|eines)"


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def key_variants(value):
    """Return keys that make a noun with an article/plural match its base word."""
    text = clean(value).lower()
    if not text:
        return set()
    candidates = {text}
    before_comma = text.split(",", 1)[0].strip()
    candidates.add(before_comma)
    without_article = re.sub(rf"^{ARTICLES}\s+", "", before_comma)
    candidates.add(without_article)
    return {
        re.sub(r"[^\wäöüß]+", " ", candidate, flags=re.UNICODE).strip()
        for candidate in candidates
        if candidate
    }


def pos_label(pos):
    pos = clean(pos)
    if pos in {"der", "die", "das", "der, die", "der, das", "die (pl)"}:
        return "Noun"
    return {
        "noun": "Noun",
        "verb": "Verb",
        "adj": "Adjective",
        "adv": "Adverb",
        "pron": "Pronoun",
        "prep": "Preposition",
        "conj": "Conjunction",
        "particle": "Particle",
        "num": "Number",
        "phrase": "Phrase",
    }.get(pos, pos.title())


def build_card(row, number):
    word = clean(row.get("word"))
    article = clean(row.get("article"))
    german = " ".join(part for part in (article, word) if part)
    if not german:
        return None

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
        "id": f"a2-common-{clean(row.get('id')) or number}",
        "number": number,
        "german": german,
        "forms": " · ".join(forms),
        "sentenceDe": clean(row.get("example_de")),
        "english": clean(row.get("english")),
        "sentenceEn": clean(row.get("example_en")),
        "rank": clean(row.get("rank")),
        "partOfSpeech": clean(row.get("pos")),
        "level": "A2",
        "source": "goethe-5000",
    }


def build(source_path):
    all_existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
    # Rebuilding is safe: replace only cards previously generated from this source,
    # while preserving the user's original deck cards and their stable IDs.
    existing = [card for card in all_existing if card.get("source") != "goethe-5000"]
    existing_keys = set()
    for card in existing:
        existing_keys.update(key_variants(card.get("german")))

    with source_path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        a2_rows = [
            row
            for row in rows
            if clean(row.get("level")) == "A2"
            and clean(row.get("source")) == "goethe-5000"
            and clean(row.get("word"))
            and clean(row.get("english"))
        ]

    added = []
    next_number = max((int(card.get("number", 0)) for card in existing), default=0) + 1
    for row in sorted(a2_rows, key=lambda item: int(item.get("rank_in_level") or 999999)):
        card = build_card(row, next_number)
        if not card or key_variants(card["german"]) & existing_keys:
            continue
        added.append(card)
        existing_keys.update(key_variants(card["german"]))
        next_number += 1

    cards = existing + added
    OUTPUT.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"kept {len(existing)} existing cards; added {len(added)} common A2 cards; wrote {len(cards)} cards to {OUTPUT}")
    print(f"source: {SOURCE_URL}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to german_vocab_a1_c2.csv")
    build(parser.parse_args().source)
