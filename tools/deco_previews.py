"""Makes the still previews for the profile picture decorations.

The decorations in assets/img/pfp-deco are animated pngs (about 1 MB each), so the decoration picker in
Settings -> Profile shows small still previews instead and only animates the one you hover. Run this after
adding a decoration:

    pip install pillow
    python tools/deco_previews.py
"""
from pathlib import Path

from PIL import Image, ImageSequence

DECO = Path(__file__).resolve().parent.parent / "assets" / "img" / "pfp-deco"
OUT = DECO / "previews"


def main():
    OUT.mkdir(exist_ok=True)
    for png in sorted(DECO.glob("*.png")):
        # use the frame where the most of the decoration is showing (some fade in from nothing)
        best, best_score = None, -1
        for i, frame in enumerate(ImageSequence.Iterator(Image.open(png))):
            if i % 3:
                continue
            frame = frame.convert("RGBA")
            score = frame.getchannel("A").point(lambda v: 255 if v > 40 else 0).histogram()[255]
            if score > best_score:
                best, best_score = frame.copy(), score
        best.resize((144, 144), Image.LANCZOS).save(OUT / f"{png.stem}.webp", "WEBP", quality=85, method=6)
        print("made", png.stem)


if __name__ == "__main__":
    main()
