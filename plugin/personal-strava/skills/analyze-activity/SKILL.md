---
name: analyze-activity
description: Analyze one Strava activity in detail using its summary, laps, and time-series streams. Use for pace, speed, heart-rate, power, cadence, elevation, route, split, or performance questions about a specific workout.
---

# Analyze a Strava activity

1. Resolve the activity ID with `get-recent-activities` when the user identifies
   an activity by relative wording such as "my latest ride".
2. Call `get-activity-details` before requesting high-volume data.
3. Request `get-activity-streams` with `summary_only: true` and low resolution
   first. Ask only for stream types relevant to the question.
4. Use `get-activity-laps` for split or interval analysis and
   `get-activity-photos` only when photos are relevant to the request.
5. Fetch detailed streams only when they materially improve the answer. Prefer
   compact output and a bounded `max_points`; avoid high resolution by default.
6. Keep elapsed time and moving time distinct. State units for pace, speed,
   elevation, heart rate, cadence, and power.
7. Treat missing sensors and paused sections as missing context, not zero effort.
8. Avoid exposing exact home or private coordinates. If the user explicitly
   requests precise coordinates, warn that they may reveal sensitive locations
   and obtain confirmation before including them.

Present a short workout overview, the requested analysis, important caveats,
and the strongest evidence from the activity data.
