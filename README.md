# German Flashcard App

An Anki-style German vocabulary app with German A2 and B1 decks, multiple-choice answers, saved progress, and spaced repeat buttons.

## Deploy with Vercel

Import this GitHub repository into Vercel. The included `vercel.json` routes the static app from `dist/`, so no build command is required.

## Run locally

```powershell
python -m http.server 4173 -d dist
```

Then open `http://127.0.0.1:4173`.

## A2 vocabulary source

The A2 deck keeps the original cards and adds the common A2 subset from the
public [Deutsch Karten vocabulary dataset](https://github.com/hasharmujahid/deutsch-karten),
filtered to its `goethe-5000` A2 entries. The official [Goethe A2 word list](https://www.goethe.de/pro/relaunch/prf/de/Goethe-Zertifikat_A2_Wortliste.pdf)
is used as the level reference. To rebuild the merged deck, download the CSV
from that dataset and run:

```powershell
python scripts/build_a2_common.py C:\path\to\german_vocab_a1_c2.csv
```
