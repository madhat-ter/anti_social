# What anti has cost so far

Computed on 2026-11-08 19:16 UTC by `bun scripts/cost.ts` from the Claude Code transcripts of this project (20 sessions, 2026-11-07 to 2026-11-08).

## Model usage (the build)

| Model | Turns | Input | Output | Cache read | Cache write (5 min) | Cache write (1 h) | Cost at list price |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude-opus-5-5 | 1609 | 0.00 M | 1.53 M | 608.43 M | 0.19 M | 3.71 M | $183.01 |
| claude-fable-5-1 | 292 | 0.01 M | 0.48 M | 80.06 M | 0.00 M | 1.58 M | $75.67 |
| claude-sonnet-5-5 | 87 | 0.00 M | 0.13 M | 4.67 M | 0.45 M | 0.00 M | $3.31 |
| claude-haiku-5-5 | 3 | 0.00 M | 0.00 M | 0.01 M | 0.01 M | 0.00 M | $0.00 |
| **Total** | 1991 | 0.01 M | 2.14 M | 693.17 M | 0.65 M | 5.29 M | **$262.00** |

Human messages typed across all sessions: 258.

Prices used ($ per million tokens): claude-fable-5-1 in 10 / out 50 / cache read 0.25 / cache write 12.5 (5 min) or 20 (1 h); claude-fable-5 in 10 / out 50 / cache read 0.25 / cache write 12.5 (5 min) or 20 (1 h); claude-opus-5-5 in 4 / out 20 / cache read 0.2 / cache write 5 (5 min) or 8 (1 h); claude-opus-5 in 5 / out 25 / cache read 0.5 / cache write 6.25 (5 min) or 10 (1 h); claude-sonnet-5-5 in 2 / out 10 / cache read 0.2 / cache write 2.5 (5 min) or 4 (1 h); claude-sonnet-5 in 2 / out 10 / cache read 0.2 / cache write 2.5 (5 min) or 4 (1 h); claude-haiku-5-5 in 0.1 / out 0.5 / cache read 0.01 / cache write 0.125 (5 min) or 0.2 (1 h).

## Per session

| Session | Started | Turns | Cost |
|---|---|---:|---:|
| 5c848df6 | 2026-11-07 13:21 | 395 | $54.15 |
| 9a2ee2b4 | 2026-11-07 13:47 | 12 | $0.47 |
| 9a2ee2b4 | 2026-11-07 13:47 | 8 | $0.32 |
| 9a2ee2b4 | 2026-11-07 13:51 | 12 | $0.40 |
| 9a2ee2b4 | 2026-11-07 14:16 | 7 | $0.21 |
| 9a2ee2b4 | 2026-11-07 14:20 | 8 | $0.21 |
| 9a2ee2b4 | 2026-11-07 15:59 | 20 | $0.74 |
| 9a2ee2b4 | 2026-11-07 15:59 | 20 | $0.95 |
| 228b442f | 2026-11-07 16:38 | 166 | $15.10 |
| 684fbced | 2026-11-07 17:50 | 12 | $1.23 |
| ce72167b | 2026-11-08 04:39 | 32 | $1.41 |
| 36cff026 | 2026-11-08 05:14 | 29 | $1.39 |
| 36cff026 | 2026-11-08 05:20 | 3 | $0.00 |
| be7f97f4 | 2026-11-08 05:31 | 99 | $11.28 |
| 71a39b3e | 2026-11-08 05:40 | 829 | $95.33 |
| 0174e8ec | 2026-11-08 05:45 | 130 | $32.49 |
| d8330c2c | 2026-11-08 13:58 | 80 | $11.13 |
| d8330c2c | 2026-11-08 13:59 | 7 | $0.44 |
| a96c89f3 | 2026-11-08 16:12 | 102 | $33.54 |
| a96c89f3 | 2026-11-08 16:12 | 20 | $1.19 |

## Everything else

| Item | Cost so far |
|---|---:|
| Hosting: Vercel Hobby (web) | $0 (free plan) |
| Hosting: Render free web service (API) + free Postgres | $0 (free plan; the database expires 30 days after creation) |
| Domain | $0 (none yet; the site runs on anti-social-opal.vercel.app) |
| Image storage | $0 (images live in the Render database) |
| Payments | $0 (fake Stripe; nobody has been charged) |
| Fonts, icons, libraries | $0 (open source; Google Fonts served from the build) |

## How to read this

- The model figure is what the tokens would cost at Anthropic's API list prices. On a Claude subscription (Pro or Max) the money actually spent is the subscription fee, and this number is the value consumed against it.
- Cache writes without a recorded TTL are priced as 5-minute writes (the cheaper rate). Sessions run with a 1-hour cache cost more where the transcript did not say which.
- Subagent turns are included (their transcripts live under the same project folder). Turns the transcript did not record usage for are not.
- Re-run `bun scripts/cost.ts` any time; it rewrites this file.
