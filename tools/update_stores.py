"""Snapshot the remote game sources into assets/data/games/<store>.json.

Several sources don't send CORS headers, so the site can't fetch them live
from a static host. Run this whenever you want fresh game lists:

    python tools/update_stores.py

Every entry is normalized to {"name", "url", "img"} plus an optional "mode":
    (none)  load the url straight into the game iframe
    "html"  fetch the url as text and write it into the iframe (jsDelivr serves .html as text/plain)
    "proxy" open the url through the proxy (site blocks framing, or it's a full website)
"""

import json
import pathlib
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "data" / "games"
UA = {"User-Agent": "Mozilla/5.0 (lonlii store updater)"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def absolute(base, path):
    return urllib.parse.urljoin(base, path.strip()) if path else ""


def velara():
    base = "https://velara.cc/"
    # velara sends X-Frame-Options: SAMEORIGIN, so its games only run through the proxy
    return [
        {"name": g["title"], "url": absolute(base, g["location"]), "img": absolute(base, g.get("image")), "mode": "proxy"}
        for g in get_json(base + "data/games.json")
    ]


def truffled():
    base = "https://truffled.lol/"
    games = []
    for g in get_json(base + "js/json/g.json")["games"]:
        entry = {"name": g["name"], "url": absolute(base, g["url"]), "img": absolute(base, g.get("thumbnail"))}
        if g.get("frameType") == "proxy":
            entry["mode"] = "proxy"
        games.append(entry)
    return games


def selenite():
    base = "https://selenite.cc/resources/"
    games = []
    for g in get_json(base + "games.json"):
        dir_url = f"{base}semag/{g['directory']}/"
        games.append({"name": g["name"], "url": dir_url + "index.html", "img": absolute(dir_url, g.get("image"))})
    return games


def wasm_rip():
    base = "https://wasm.rip/"
    return [
        {"name": g["name"], "url": absolute(base, g["gameUrl"]), "img": absolute(base, g.get("imageUrl"))}
        for g in get_json(base + "games.json")
    ]


def zones():
    html_url = "https://cdn.jsdelivr.net/gh/freebuisness/html@main"
    cover_url = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main"
    games = []
    for g in get_json("https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json"):
        # skip the non-game entries (discord invites etc.)
        if not g["url"].startswith("{HTML_URL}"):
            continue
        games.append({
            "name": g["name"],
            "url": g["url"].replace("{HTML_URL}", html_url),
            "img": g.get("cover", "").replace("{COVER_URL}", cover_url),
            "mode": "html",
        })
    return games


STORES = {
    "velara": velara,
    "truffled": truffled,
    "selenite": selenite,
    "wasm.rip": wasm_rip,
    "zones": zones,
}

if __name__ == "__main__":
    for name, fn in STORES.items():
        try:
            games = sorted(fn(), key=lambda g: g["name"].lower())
        except Exception as e:
            print(f"{name}: failed ({e}), keeping the old snapshot")
            continue
        (OUT / f"{name}.json").write_text(json.dumps(games, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{name}: {len(games)} games")
