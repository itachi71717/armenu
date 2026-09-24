# Storage and cost planning for 100+ restaurants

## The maths

Assumptions for 100 restaurants × 35 dishes = **3,500 dishes**:

| Asset per dish | Realistic size | Total for 3,500 dishes |
|---|---|---|
| `.glb` (Android AR + 3D) | 2 – 4 MB | ~10 GB |
| `.usdz` (iOS Quick Look) | 3 – 6 MB | ~16 GB |
| Thumbnail `.jpg` | 100 – 200 KB | ~0.5 GB |
| **Storage subtotal** | **~7 MB / dish** | **~26 GB** |

Bandwidth (egress) at 50 diners/day per restaurant, each viewing 2 dishes in AR:
- `100 × 50 × 2 × 7 MB = 70 GB/day`
- **~2 TB per month at cruise speed**

## Provider comparison (26 GB storage + 2 TB egress per month)

| Provider | Storage cost | Egress cost | **Monthly total** | Notes |
|---|---|---|---|---|
| **Cloudflare R2** | 26 GB × $0.015 = **$0.39** | **$0** | **~$1** | Egress is always free. This is the winner. |
| Backblaze B2 | 26 GB × $0.006 = $0.16 | 2 TB × $0.01 = $20 | ~$20 | |
| Supabase Storage (Pro) | Included in $25/mo (100 GB) | $0.09/GB beyond 200 GB = 1.8 TB × $0.09 = **$162** | **$187** | Egress kills you at scale. |
| AWS S3 | 26 GB × $0.023 = $0.60 | 2 TB × $0.09 = $180 | ~$180 | |
| Vercel Blob | 26 GB, Pro tier $20/mo | 2 TB × $0.15/GB after free = ~$225 | ~$245 | |

**Cloudflare R2 is 100 – 200× cheaper than the alternatives at this scale, and gets cheaper (relatively) the more you grow, because egress stays free forever.**

## Cost comparison for database + auth

| Component | Free tier good enough? | Pro cost when needed |
|---|---|---|
| **Neon** Postgres | Yes, forever. Auto-resumes. 0.5 GB storage. | $19/mo when you exceed 0.5 GB (thousands of dishes fit) |
| **Supabase** database | No — auto-pauses after 7 days idle | $25/mo Pro (no pause + 8 GB) |
| **Clerk** auth | Yes, up to 10,000 monthly active users | $25/mo after 10k MAU |
| **Vercel** hosting | Yes for hobby projects | $20/mo Pro when you outgrow |

## Ship-ready recommended stack (targets 100+ restaurants, all-in cost <$5/month)

```
Frontend + API   → Vercel Hobby           $0
Database         → Neon Free              $0  (auto-resume, never pauses meaningfully)
File storage     → Cloudflare R2          ~$1/mo at 26 GB, $0 egress forever
Auth (portal)    → Clerk Free             $0  (up to 10k users)
AR generation    → Meshy (Ian's key)      Pay per dish (~$0.10 each, one-time cost)
```

**Total ongoing: about $1 – $5 / month at 100 restaurants**, plus one-time Meshy generation cost per new dish.

When you exceed ~10,000 restaurants or 100k MAU, budget an extra $20 – $50/mo for tier upgrades.

## What I need from you to migrate

**Option A — Keep Supabase Pro** ($25/mo): pay Supabase, everything works as-is. No code changes. Fastest path.

**Option B — Move to the recommended stack** (~$1 – 5/mo):
1. Sign up at https://neon.tech, create a project, share the connection string
2. Sign up at https://dash.cloudflare.com (free), enable R2, share the access key + secret + bucket name
3. I rewrite `api/_db.js` to use Neon and `api/_h/admin/ai-generate.js` (plus `upload-url.js` and `compress.js`) to use R2 instead of Supabase Storage.
4. About 45 minutes of my work.

Recommendation: **Option B**. It's meaningfully cheaper at every scale after month 1, and never has the pause-risk.

---

## The one hidden variable: Meshy generation cost

AR Studio calls Meshy to generate each `.glb`. Meshy pricing (as of Sep 2026):
- Free tier: 200 credits/month (roughly 20 image-to-3D jobs)
- Pro: $20/month for 1,000 credits (~100 dishes/month generated)
- Enterprise: custom, unlimited

So for 100 restaurants × 35 dishes = 3,500 generations initially:
- On Pro at $20/mo: 35 months of onboarding, OR
- One-time Enterprise burst quote from Meshy sales

Every subsequent regeneration also costs. If you plan an onboarding blitz, budget for Meshy enterprise from day one.
