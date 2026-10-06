# Highland Bulldogs game strip

`index.html` shows the game strip for Varsity and JV. `games.ics` is refreshed every hour
by `.github/workflows/update.yml`, which downloads each team's TeamSnap feed and keeps only games.

Feed links are stored as repository secrets: `TEAMSNAP_FEED_VARSITY` and `TEAMSNAP_FEED_JV`
(Settings > Secrets and variables > Actions). The links come from a personal TeamSnap account.
When the person who set this up leaves the club, the new webmaster should get their own team
calendar links in TeamSnap and replace both secrets. Nothing else needs to change.

Show one team only by adding `?team=varsity` or `?team=jv` to the page address.
