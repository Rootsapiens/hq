# Rootsapiens: AI Social Media Agency

Rootsapiens plans, creates and quality-checks social media content for brands: posts, carousels, reels and
stories. AI does the volume; a fixed pipeline and a scored quality gate keep the work at agency standard.
The owner (Nadeem) is the only one who publishes, spends or talks to clients.

## Org chart

```
                         Owner (Nadeem)
              publishes · spends · signs · talks to clients
                               │
                       Cyrex: CEO
       priorities, content calendar, routing, final approval
                               │
   ┌────────────┬──────────────┼──────────────┬──────────────┐
 Zurub        Nedal          Aktham         Rajaie         Razan
 CSO          CMO            CCO            CTO            CPO
 Strategy &   Content, Copy  Creative       AI Production  People &
 Research     & Reels                       & Data         Quality
```

| Agent | Owns | Delivers (as files) |
|---|---|---|
| **Cyrex**: CEO | Client priorities, calendar, routing, final sign-off | Weekly priorities, approvals |
| **Zurub**: CSO, Strategy & Research | Audience, platforms, pillars, trends, competitors, KPIs | Brief per post or campaign, content calendar, trend scan (sourced) |
| **Nedal**: CMO, Content, Copy & Reels | Voice, hooks, captions, scripts | Post copy, captions, hashtags, CTAs, reel and story scripts with 3 hook options |
| **Aktham**: CCO, Creative | Brand kit, visual direction, AI imagery | Image prompts (with negatives), carousel layouts, thumbnails, aspect ratios and safe zones |
| **Rajaie**: CTO, AI Production & Data | Reel production, AI video and voice, scheduling, HQ platform | Edit spec, export settings, licensed music cues, scheduling plan, performance report from real analytics |
| **Razan**: CPO, People & Quality | Quality gate, brand safety, rights, onboarding, watchdog | Scored QA file per asset, onboarding checklists, audit notes to the owner |

## Pipeline

```
1 BRIEF  ──▶  2 CREATE  ──▶  3 PRODUCE  ──▶  4 QA  ──▶  5 APPROVE  ──▶  6 PUBLISH
Zurub     Nedal       Rajaie          Razan     Cyrex       Owner only
              + Aktham                        │
                    ▲      fail: exact fixes  │
                    └─────────────────────────┘
```

Each step starts only when the previous step's file exists. Files name the client, platform and post id.

## Quality gate (Razan)

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

## Skills

Each agent carries a library of skills (playbooks in `skills/`), assigned in `skills/assignments.json`.
Agents see their skills' names and descriptions and open the full playbook with the `use_skill` tool
when the work calls for it. The Roster shows every agent's skills.

Every agent has 10 skills.

| Agent | Agency skills (ours) | Imported |
|---|---|---|
| Cyrex (CEO) | campaign-orchestration | marketing-plan, launch, offers, pricing, product-marketing, marketing-ideas, co-marketing, analytics, marketing-loops |
| Zurub (CSO) | social-research-brief, content-calendar, competitor-scan | customer-research, competitors, competitor-profiling, reverse-engineer-marketing, marketing-psychology, content-strategy, ai-seo |
| Nedal (CMO) | reel-script, caption-writing, hook-writing | social, copywriting, copy-editing, video, emails, influencer-marketing, community-marketing |
| Aktham (CCO) | carousel-design, ai-image-prompting, brand-kit | theme-factory, canvas-design (Apache-2.0, anthropics/skills); image, ad-creative, lead-magnets, cro, site-architecture |
| Rajaie (CTO) | reel-edit-spec, platform-specs, scheduling-plan | frontend-design, mcp-builder (Apache-2.0, anthropics/skills); conversion-tracking, attribution, schema, seo-audit, ads |
| Razan (CPO) | content-qa-checklist, team-onboarding | internal-comms (Apache-2.0, anthropics/skills); onboarding, churn-prevention, public-relations, sales-enablement, referrals, revops, prospecting |

Imported skills without a note come from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT).
Each imported folder keeps its LICENSE and a SOURCE.md with the commit.
Some imported skills describe tools HQ agents cannot run (image generators, ad platforms, analytics APIs);
agents use the method and skip those steps.

Add a skill from any GitHub repository:

```bash
npm run skills:add -- https://github.com/<owner>/<repo> <path/to/skill-folder> --agent <id>
```

The command copies only Markdown and licence files (no scripts), refuses skills without an open
licence (Apache, MIT, BSD, ISC, CC-BY), and writes `SOURCE.md` with the repository, commit and licence.
Imported skills that expect to run code only partly apply: HQ agents read and write text files.

## Hiring

New agents report to one of the C-suite and are named after Mortal Kombat 3 characters.

## Rules every agent follows

- No publishing, scheduling on live accounts, ad spend or client contact. The owner does those.
- No invented metrics, follower counts, trends or quotes; unverified claims are marked.
- Only licensed music and assets with stated rights.
- Every deliverable is a file in HQ (Files tab); chat carries the summary.

## Try it in HQ

Sign in as owner and send Cyrex, for example:

> Campaign for a coffee shop launch on Instagram: @zurub write the brief and a 2-week calendar,
> then @nedal 3 reel scripts and 5 captions, @aktham the carousel and thumbnail direction,
> @rajaie the reel edit spec, and @razan QA everything before I see it.

Configuration lives in `shared/company.ts` (name, rooms) and `server/agents.config.ts` (roles, pipeline, rules).
