---
name: review-training
description: Review or compare the user's Strava training volume, consistency, intensity, and trends across a date range. Use for weekly or monthly summaries, period comparisons, and questions about recent training patterns.
---

# Review Strava training

Use the connected Strava tools to ground every conclusion in returned activity
data. Do not estimate activities or metrics that were not returned.

1. Clarify the sport and date range only when the request does not provide
   enough context. Convert relative periods into explicit ISO dates.
2. Use `get-all-activities` for bounded period analysis. Apply activity or
   sport-type filters when known, and keep API-call limits conservative.
3. Compare equal-length periods. Separate running, riding, and other sports
   before combining totals.
4. Summarize activity count, distance, moving time, elevation gain, and any
   available heart-rate or power data. Clearly label unavailable metrics.
5. Describe consistency, volume changes, and notable outliers. Distinguish
   observations from interpretations and avoid medical diagnoses.
6. End with a concise summary and the activity evidence that supports it.

Use `get-athlete-zones` only when intensity distribution is relevant. Respect
the user's units and state conversions explicitly.
