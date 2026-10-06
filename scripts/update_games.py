"""Download each team's TeamSnap feed, keep only games, and write games.ics.

Feed links come from repository secrets, so the private links never appear
in the public repository or website. Add or remove teams in TEAMS below.
"""
import os, re, sys, urllib.request

TEAMS = [
    # (label shown on the cards, name of the GitHub secret holding the feed link)
    ("Varsity", "TEAMSNAP_FEED_VARSITY"),
    ("JV", "TEAMSNAP_FEED_JV"),
]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Bulldogs schedule updater)"})
    text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    if "BEGIN:VCALENDAR" not in text:
        raise RuntimeError("TeamSnap did not return a calendar. First 200 chars:\n" + text[:200])
    return re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n"))   # unfold long lines

all_games, problems, used = [], [], 0
for label, secret in TEAMS:
    url = os.environ.get(secret, "").strip()
    if not url:
        print(f"{label}: secret {secret} not set, skipping")
        continue
    used += 1
    try:
        text = fetch(url)
    except Exception as e:
        problems.append(f"{label}: {e}")
        continue
    events = re.findall(r"BEGIN:VEVENT\n.*?END:VEVENT", text, re.S)
    games = [e for e in events if re.search(r"^SUMMARY[^:]*:.*\bgame\b", e, re.I | re.M)]
    games = [re.sub(r"\n?CATEGORIES[^\n]*", "", g).replace("\nEND:VEVENT", f"\nCATEGORIES:{label}\nEND:VEVENT")
             for g in games]
    print(f"{label}: {len(events)} events in feed, {len(games)} games kept")
    all_games += games

if not used:
    sys.exit("No team feed secrets are set.")
if problems:
    # keep the previous games.ics rather than publishing a partial schedule
    sys.exit("Not updating games.ics:\n" + "\n".join(problems))

out = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Highland Bulldogs//Games//EN\n"
out += "\n".join(all_games) + ("\n" if all_games else "") + "END:VCALENDAR\n"
with open("games.ics", "w", encoding="utf-8", newline="\r\n") as f:
    f.write(out)
print(f"{len(all_games)} games written to games.ics")
