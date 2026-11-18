// Token Radar — value model and farm plans for token-radar-01.
//
// Reads the sealed DefiLlama snapshot (758 protocols, 40 on the watchlist) and
// ranks the pre-token protocols by an implied value that comes only from the
// snapshot's own numbers. Nothing here names a protocol: the same arithmetic
// scores every row, and the same category playbook writes every farm plan.
//
// Model "radar-2" — four factors, all visible in the dashboard:
//   base      = tvl_usd x 0.20
//   growth    = clamp(change_7d, -50, +150); falls count more than rises do,
//               so growthMult = 1 + growth/100 x 0.6 when growth >= 0,
//               and 1 + growth/100 x 0.9 when growth < 0
//   maturity  = 0.55 + 0.45 x min(age_days, 1460) / 1460
//               (age unknown: 180 days — a young protocol earns no seniority
//               it cannot show; listed_at is the day DefiLlama began tracking it)
//   breadth   = 1 + 0.02 x min(chains - 1, 5)   (multi-chain reach, capped +10%)
//   implied   = max(1, round(base x growthMult x maturity x breadth))
//
// A protocol "records no token" when the snapshot records no market cap, no
// CoinGecko id and no symbol for it. That is a statement about the record,
// never a claim that the protocol has no token. Protocols whose token already
// trades are kept out of the ranked board and shown separately, at the
// market's own capitalisation, in the dashboard's Live view.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.2,
  growth_up_weight: 0.6,
  growth_down_weight: 0.9,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 180,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

export const MODEL_VERSION = 'radar-2';

/** Early rows below the watchlist floor: the radar's whole point is finding them. */
export const EARLY_ROWS = 200;

/** Live-token protocols shown separately, by market cap. */
export const LIVE_ROWS = 30;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface ImpliedBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** The four multipliers and the implied value for one protocol. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult),
  );
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Records no token at all in the snapshot (mcap, gecko id and symbol all null). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable: pre-token, not an exchange, not a versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: every watchlist slug, plus the 200 largest rankable protocols below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------------------
// Farm plans. One playbook per category family; the chain sets the gas note
// and the TVL sets the capital tier. No protocol name is ever special-cased.
// ---------------------------------------------------------------------------

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital tier from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold window from age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Typical gas for one transaction on the protocol's first chain. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 'under $0.10 of gas per transaction on Solana';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('monad'))
    return 'under $0.50 of gas per transaction on this low-fee chain';
  if (c.includes('ethereum')) return 'about $4 to $10 of gas per transaction on Ethereum';
  if (c.includes('bitcoin')) return 'about $5 to $15 of network fees per Bitcoin transaction';
  if (c.includes('tron') || c.includes('polygon') || c.includes('bsc') || c.includes('binance'))
    return 'about $1 to $3 of gas per transaction on this chain';
  return 'about $1 to $3 of gas per transaction';
}

interface Playbook {
  open: string;
  second: string;
  weekly: string;
}

/** Category playbook: the core action, a second leg, and the weekly habit. */
function playbookFor(p: SnapshotProtocol, capital: number, chain: string): Playbook {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      open: `Supply $${capital} of USDC to ${name} on ${chain} as collateral, then borrow $20 of a stablecoin against it so the position is active on both sides.`,
      second: `Repay half the $20 borrow after a week and re-borrow it, so the lending position shows repeated use instead of one deposit.`,
      weekly: `Adjust the collateral or borrow by $5 to $10 once a week and keep the health factor above 2.`,
    };
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm'))
    return {
      open: `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain}, in a balanced pair, and keep the LP tokens in your wallet.`,
      second: `Swap $10 through the pool once, so the position records both liquidity and trading activity.`,
      weekly: `Collect fees, re-add $5 of liquidity or rebalance the range once a week while the pool stays open.`,
    };
  if (c.includes('bridge') || c.includes('canonical bridge'))
    return {
      open: `Bridge $${capital} of USDC into ${chain} through ${name}, then use at least $20 of the bridged funds in an app on ${chain}.`,
      second: `Bridge $20 back a week later, so the record shows two-way volume rather than a single one-way transfer.`,
      weekly: `Make one small bridge of $10 to $20 each week, alternating direction when the route allows it.`,
    };
  if (c.includes('staking') || c.includes('restak') || c.includes('liquid staking'))
    return {
      open: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token it issues.`,
      second: `Use $20 of the receipt token in a lending or liquidity pool on ${chain} so the stake is productive, not idle.`,
      weekly: `Top up the stake by $5 to $10 once a week and claim or restake any rewards the protocol shows.`,
    };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return {
      open: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position worth $20, with a stop-loss set.`,
      second: `Close that position after a few days and open a second one in the opposite direction, keeping total exposure under $25.`,
      weekly: `Place one small trade a week and never let open exposure exceed $25 at any time.`,
    };
  if (c.includes('yield') || c.includes('farm') || c.includes('allocator') || c.includes('curator'))
    return {
      open: `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares it issues.`,
      second: `Split $20 into a second vault of the same protocol, so the record shows two strategies instead of one deposit.`,
      weekly: `Claim any rewards the vault shows and redeposit $5 to $10 once a week.`,
    };
  if (c.includes('rwa') || c.includes('stable') || c.includes('anchor'))
    return {
      open: `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your farming wallet.`,
      second: `Use $20 of that asset as collateral or liquidity on ${chain} so the holding is active, not just parked.`,
      weekly: `Check the yield accrual once a week and add $5 to $10 to the position while it pays out.`,
    };
  if (c.includes('prediction'))
    return {
      open: `Fund $${capital} on ${name} on ${chain} and place one $10 position on a market that settles within two weeks.`,
      second: `Place a second $10 position on a different market, so the record shows breadth rather than one bet.`,
      weekly: `Settle or close one position a week and open one new $10 position.`,
    };
  if (c.includes('insurance'))
    return {
      open: `Buy $${capital} of cover from ${name} on ${chain} for a protocol or asset you already use, and keep the policy active.`,
      second: `Stake $20 in the protocol's underwriting pool if it offers one, so you are both a buyer and a backer.`,
      weekly: `Review the cover once a week and renew or extend it before it lapses.`,
    };
  if (c.includes('payment') || c.includes('chain'))
    return {
      open: `Move $${capital} through ${name} on ${chain} for a real payment or transfer, and keep the receipt in your farm log.`,
      second: `Repeat the payment with $20 a week later, using a different recipient or asset if the protocol allows it.`,
      weekly: `Make one $10 to $20 payment a week through the protocol.`,
    };
  return {
    open: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in your farming wallet.`,
    second: `Use $20 of the position in a second feature of the same protocol, such as a swap, a vote or a second pool.`,
    weekly: `Make one small qualifying action a week, such as a $5 deposit, a swap or a vote.`,
  };
}

/** Seven steps: setup, core action, second leg, weekly habit, hold, safety, log and exit. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const book = playbookFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the $${capital} you plan to farm, write its seed phrase on paper and keep it offline.`,
      cost: 'nothing but the wallet setup',
      time: '5 minutes',
    },
    { text: book.open, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: book.second, cost: 'about $20 of the capital already deposited', time: '10 minutes' },
    { text: book.weekly, cost: gas, time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days and check the protocol's own points or rewards page once a week, so the activity spans more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days, 5 minutes a week to check`,
    },
    {
      text: `Never pay anyone to claim a reward and never sign a transaction you cannot read; claim only from the link the protocol itself publishes.`,
      cost: 'no fee to check',
      time: '5 minutes',
    },
    {
      text: `Log the wallet address, every transaction hash and the dates, then unwind in reverse order when you exit: claim first, withdraw second, revoke approvals last.`,
      cost: 'nothing but the log',
      time: '10 minutes to exit',
    },
  ];
}

/** One step as a single string with its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Live-token protocols, by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
