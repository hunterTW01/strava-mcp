---
name: athlete-insights
description: Review the connected athlete's Strava profile, aggregate statistics, training zones, equipment, or clubs. Use for athlete summaries, year-to-date or all-time totals, zone context, shoe mileage, and club membership questions.
---

# Review athlete insights

1. Use `get-athlete-profile` to obtain the athlete ID and basic profile before
   calling athlete-specific tools.
2. Use `get-athlete-stats` with the returned athlete ID for recent, year-to-date,
   and all-time totals. Keep those periods separate in the response.
3. Use `get-athlete-zones` when heart-rate or power-zone context is needed. Do
   not invent thresholds when zones are missing.
4. Use `get-athlete-shoes` for shoe mileage and primary-shoe questions. State
   the units and avoid claiming replacement is medically necessary.
5. Use `list-athlete-clubs` for membership questions. Do not infer private club
   details that Strava did not return.

Explain whether each result is a current profile value, a recent statistic, a
year-to-date total, or an all-time total. Avoid medical conclusions from
training zones, weight, or aggregate statistics.
