# Storage & bandwidth costs. Recalculated for realistic file sizes.

## Assumption
Per dish: `.glb` + `.usdz` + thumbnail. Realistic sizes for AR-Studio-generated PBR dishes: about **150-200 MB total per dish** when meshy hits max quality (photo-realistic PBR with baked 4K textures). For lower quality (~2K textures) it's more like 10-20 MB. The 200 MB figure is the WORST CASE — I'll assume it for planning.

## Storage at scale

| Restaurants | Dishes per | Total dishes | Storage @ 200 MB/dish |
|---|---|---|---|
| 10 | 35 | 350 | 70 GB |
| 100 | 35 | 3,500 | 700 GB |
| 500 | 35 | 17,500 | 3.5 TB |
| 1,000 | 40 | 40,000 | 8 TB |

## Bandwidth
Assume every dish is viewed on average 2 times a day per active restaurant, 50 diners per restaurant:
- 100 restaurants × 50 diners × 2 dish views × 200 MB = **2 TB/day = 60 TB/month**
- 500 restaurants: 300 TB/month
- 1,000 restaurants: 800 TB/month

## Provider cost comparison at 100 restaurants (700 GB storage + 60 TB egress)

| Provider | Storage | Egress | **Monthly total** | Notes |
|---|---|---|---|---|
| **Cloudflare R2** | 700 GB × $0.015 = **$10.50** | **$0 always** | **$10-15** | Winner by orders of magnitude. Egress is free forever. |
| Backblaze B2 | 700 GB × $0.006 = $4.20 | 60 TB × $0.01 = $614 | $618 | |
| Supabase Storage Pro | 700 GB (over 100 GB tier) → +$126 | 60 TB × $0.09 (over 200 GB) = $5,382 | **$5,500+** | Would bankrupt you at scale. |
| AWS S3 | 700 GB × $0.023 = $16.10 | 60 TB × $0.09 = $5,530 | $5,550 | |
| Vercel Blob | 700 GB × $0.15 = $105 | 60 TB × $0.30 = $18,432 | $18,500 | Not viable. |

**Cloudflare R2 is the only sane choice at this file-size scale.**

## Cost projection using recommended stack (Neon + R2 + Clerk + Vercel + Meshy)

At **100 restaurants × 35 dishes at 200 MB each = 700 GB / 60 TB egress**:
```
Neon database         $0/mo (free tier fits 3,500 dish records easily)
Cloudflare R2         $10.50/mo storage. $0 egress.
Clerk auth            $0/mo (well under 10k MAU)
Vercel hosting        $0/mo (Hobby fine for the marketing site + 1 API function)
Meshy generation      $0.10-0.30 per dish, one-time. 3,500 dishes × $0.20 = $700 one-time cost during onboarding
```
**Total ongoing: about $11/month at 100 restaurants** (or $25/mo Supabase Pro on top if you don't migrate the database).

At **500 restaurants** (3.5 TB / 300 TB egress):
- R2 storage: $52.50/mo
- Everything else: still $0/mo
- Total: about $55/mo

At **1,000 restaurants** (8 TB / 800 TB egress):
- R2 storage: $120/mo
- Neon Pro (once over 0.5 GB): $19/mo
- Clerk Pro: $25/mo
- Vercel Pro (once you outgrow Hobby): $20/mo
- Total: about $184/mo

**Even at 1,000 restaurants with 8 TB of AR assets and nearly a petabyte of monthly bandwidth, you're at $184/month.** Same load on AWS/Vercel Blob would cost you $100,000+/month.

## Realistic Meshy budget for onboarding blitz

If you're onboarding 100 restaurants in a month with 35 dishes each:
- 3,500 generations
- Free tier: 20/month (way too small)
- Pro at $20/mo: 100 generations
- Enterprise: quote from meshy.ai — expect $500-1,500 for 3,500 credits burst

Talk to Meshy sales for a startup enterprise burst discount if you're onboarding fast.

## What you don't pay for at scale
- Egress ("bandwidth"): $0 with R2, forever, regardless of TB.
- Redundancy: R2 replicates automatically.
- SSL: Cloudflare terminates.
- Nights/weekends: no autoscaling surprises.
