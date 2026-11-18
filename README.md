# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Nice31i/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Nice31i/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar for make.fun's "Build the best token launch radar" bounty. It ranks 240 pre-token protocols by an implied value computed from the sealed DefiLlama snapshot — TVL, seven-day growth, time running with no token recorded, and chain reach — and gives every protocol a concrete farm plan with costs and times. Protocols whose token already trades are kept out of the ranking and shown separately at their market capitalisation.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22 or later, standard library only. The program reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory.

## Value model (radar-2)

```
implied = TVL × 0.20 × growth × maturity × breadth
  growth   = 1 + clamp(change_7d, -50%, +150%) / 100 × 0.6 (rises) or × 0.9 (falls)
  maturity = 0.55 + 0.45 × min(age_days, 1460) / 1460   (unknown age: 180 days)
  breadth  = 1 + 0.02 × min(chains − 1, 5)
```

No protocol name is special-cased. "Records no token" means the snapshot records no market cap, CoinGecko id or symbol for the protocol — a statement about the record, never a claim that the protocol has no token.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
