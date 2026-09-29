---
name: routes-and-segments
description: Work with the user's Strava routes, starred segments, segment efforts, leaderboards, and geographic segment exploration. Use for route discovery, segment history, and performance comparisons.
---

# Work with routes and segments

Use route and segment identifiers returned by Strava instead of guessing IDs.

1. Use `list-athlete-routes` for the user's routes and `get-route` for details.
2. Use `list-starred-segments`, `get-segment`, `get-segment-effort`, and
   `list-segment-efforts` to review known segments and the user's history.
3. Use `get-segment-leaderboard` when the user asks for rankings or filtered
   comparisons.
4. Use `explore-segments` only with a clear geographic bounding box. Avoid
   revealing a precise home location in the response.
5. Treat leaderboard results as a snapshot and state any gender, age, date,
   following, club, or weight filters applied.
6. `star-segment` changes Strava data. Obtain explicit confirmation immediately
   before starring or unstarring, and state which segment will change.

Do not imply that a leaderboard or effort comparison is complete when Strava
returns a partial page or filtered result.
