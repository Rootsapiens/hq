---
name: scheduling-plan
description: Produce a scheduling plan the owner can load into a scheduler (date, time, platform, asset file, caption file, first comment). Use after QA passes.
---
# Scheduling plan (CTO)

Save as `schedule-<client>-<period>.csv` with columns:
`date,time,timezone,platform,post_id,asset_file,caption_file,first_comment,link,status`

- Times come from the client's analytics if the owner shared them; otherwise mark `time: owner to confirm`.
- Only QA-passed and approved assets.
- Never post or schedule on live accounts; the owner loads this file.
