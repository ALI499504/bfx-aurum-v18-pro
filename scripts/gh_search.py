#!/usr/bin/env python3
"""Deep GitHub search for verified/tested gold trading strategy repositories.

Read-only research script: queries the GitHub search API for multiple
keyword sets related to verified, forward-tested, live-proven gold/XAUUSD
trading strategies. Prints a compact table per query. Does not touch the bot.
"""
import json
import time
import urllib.parse
import urllib.request

QUERIES = [
    "XAUUSD strategy",
    "gold trading bot",
    "gold EA mt5",
    "myfxbook",
    "fxblue",
    "forward tested trading",
    "trading olympiad",
    "walk-forward XAUUSD",
    "order block EA gold",
    "support resistance flip gold",
    "verified trading results EA",
    "live performance EA gold",
]

HEADERS = {
    "User-Agent": "research-script",
    "Accept": "application/vnd.github+json",
}


def search(q: str, per_page: int = 5):
    url = (
        "https://api.github.com/search/repositories?q="
        + urllib.parse.quote(q)
        + "&sort=stars&order=desc&per_page=%d" % per_page
    )
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    for q in QUERIES:
        print("=" * 84)
        print("QUERY:", q)
        try:
            data = search(q)
            total = data.get("total_count", 0)
            print(f"  (total repos: {total})")
            for it in data.get("items", []):
                desc = (it.get("description") or "")[:100].replace("\n", " ")
                stars = it["stargazers_count"]
                pushed = (it.get("pushed_at") or "")[:10]
                print(f"  *{stars:>5}  {it['full_name']:<46} push:{pushed}  {desc}")
        except Exception as e:  # noqa: BLE001
            print("  ERROR:", e)
        time.sleep(2)


if __name__ == "__main__":
    main()
