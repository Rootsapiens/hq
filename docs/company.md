# Rootsapiens: AI Social Media Agency

Rootsapiens plans, creates and quality-checks social media content for brands: posts, carousels, reels and
stories. AI does the volume; a fixed pipeline and a scored quality gate keep the work at agency standard.
The owner (Nadeem) is the only one who publishes, spends or talks to clients.

## Org chart

```
                         Owner (Nadeem)
              publishes · spends · signs · talks to clients
                               │
                  Shao Kahn: Agency Director
       priorities, content calendar, routing, final approval
                               │
   ┌──────────────┬────────────┼─────────────┬──────────────────┐
Nightwolf      Liu Kang      Sindel         Sektor            Sonya
Strategy &     Content,      Creative       AI Production     Quality &
Research       Copy & Reels  Director       & Data            Client Success
```

| Agent | Owns | Delivers (as files) |
|---|---|---|
| **Shao Kahn**: Agency Director | Client priorities, calendar, routing, final sign-off | Weekly priorities, approvals |
| **Nightwolf**: Strategy & Research | Audience, platforms, pillars, trends, competitors, KPIs | Brief per post or campaign, content calendar, trend scan (sourced) |
| **Liu Kang**: Content, Copy & Reels | Voice, hooks, captions, scripts | Post copy, captions, hashtags, CTAs, reel and story scripts with 3 hook options |
| **Sindel**: Creative Director | Brand kit, visual direction, AI imagery | Image prompts (with negatives), carousel layouts, thumbnails, aspect ratios and safe zones |
| **Sektor**: AI Production & Data | Reel production, AI video and voice, scheduling, HQ platform | Edit spec, export settings, licensed music cues, scheduling plan, performance report from real analytics |
| **Sonya**: Quality & Client Success | Quality gate, brand safety, rights, onboarding, watchdog | Scored QA file per asset, onboarding checklists, audit notes to the owner |

## Pipeline

```
1 BRIEF  ──▶  2 CREATE  ──▶  3 PRODUCE  ──▶  4 QA  ──▶  5 APPROVE  ──▶  6 PUBLISH
Nightwolf     Liu Kang       Sektor          Sonya     Shao Kahn       Owner only
              + Sindel                        │
                    ▲      fail: exact fixes  │
                    └─────────────────────────┘
```

Each step starts only when the previous step's file exists. Files name the client, platform and post id.

## Quality gate (Sonya)

Ten checks, each scored 0 or 1. Pass at **8/10 or higher** and **no fail** on the four blocking checks (marked ●).

| # | Check | Blocking |
|---|---|---|
| 1 | Matches the brief: goal, audience, platform, format, KPI | |
| 2 | Hook works in the first 2 seconds (reels) or first line (posts) | |
| 3 | Brand voice and brand kit (colour, type, logo use) | ● |
| 4 | Spelling and grammar (Arabic and English) | |
| 5 | Facts, numbers and claims sourced | ● |
| 6 | Rights: music, faces, logos, fonts, third-party content | ● |
| 7 | AI-generated assets labelled, prompt recorded | |
| 8 | Platform specs: length, aspect ratio, safe zones, caption limits | ● |
| 9 | Accessibility: captions on video, alt text, contrast on a phone | |
| 10 | Clear call to action | |

## Rules every agent follows

- No publishing, scheduling on live accounts, ad spend or client contact. The owner does those.
- No invented metrics, follower counts, trends or quotes; unverified claims are marked.
- Only licensed music and assets with stated rights.
- Every deliverable is a file in HQ (Files tab); chat carries the summary.

## Try it in HQ

Sign in as owner and send Shao Kahn, for example:

> Campaign for a coffee shop launch on Instagram: @nightwolf write the brief and a 2-week calendar,
> then @liukang 3 reel scripts and 5 captions, @sindel the carousel and thumbnail direction,
> @sektor the reel edit spec, and @sonya QA everything before I see it.

Configuration lives in `shared/company.ts` (name, rooms) and `server/agents.config.ts` (roles, pipeline, rules).
