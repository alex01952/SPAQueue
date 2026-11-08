import { OpenPlayCategory } from './open-play-players';

export interface MatchingPlayer {
  id: string;
  category: OpenPlayCategory;
  line: 'normal' | 'winners';
  waitMs: number;
  wins: number;
  games: number;
}

export interface MatchSuggestion {
  teams: [MatchingPlayer[], MatchingPlayer[]];
  mixedLines: boolean;
  mixedLevels: boolean;
}

export interface NextMatchSuggestion extends MatchSuggestion {
  category: OpenPlayCategory;
  totalWaitMs: number;
}

export const matchingModeOptions = [
  { id: 'wait-priority', label: 'Wait-time priority' },
] as const;
export type MatchingMode = typeof matchingModeOptions[number]['id'];
export const defaultMatchingMode: MatchingMode = 'wait-priority';

type MatchingStrategy = (players: MatchingPlayer[], playerLocks: string[][], forcedCategory: OpenPlayCategory | null) => NextMatchSuggestion | null;

const matchingStrategies: Record<MatchingMode, MatchingStrategy> = {
  'wait-priority': suggestWaitPriorityMatch,
};

export function isMatchingMode(value: unknown): value is MatchingMode {
  return matchingModeOptions.some((mode) => mode.id === value);
}

const levels: OpenPlayCategory[] = ['Novice', 'Intermediate', 'High Intermediate'];
const warningMs = 30 * 60000;
const nearWarningMs = 25 * 60000;

export function suggestNextOpenPlayMatch(players: MatchingPlayer[], mode: MatchingMode = defaultMatchingMode, playerLocks: string[][] = [], forcedCategory: OpenPlayCategory | null = null): NextMatchSuggestion | null {
  return matchingStrategies[mode](players, playerLocks, forcedCategory);
}

function suggestWaitPriorityMatch(players: MatchingPlayer[], playerLocks: string[][] = [], forcedCategory: OpenPlayCategory | null = null): NextMatchSuggestion | null {
  if (forcedCategory) return suggestForcedCategoryMatch(players, playerLocks, forcedCategory);
  const lockedIds = new Set(playerLocks.flat());
  const availableById = new Map(players.map((player) => [player.id, player]));
  const lockedGroups = playerLocks.filter((group) => group.length >= 2 && group.length <= 4 && group.every((id) => availableById.has(id)))
    .map((group) => group.map((id) => availableById.get(id)!));
  const unlocked = players.filter((player) => !lockedIds.has(player.id));
  const choose = (groups: MatchingPlayer[][]) => groups.flatMap((group) => (forcedCategory ? [forcedCategory] : levels).flatMap((category) => {
    const suggestion = suggestOpenPlayMatch(group, category);
    return suggestion ? [{ ...suggestion, category, totalWaitMs: suggestion.teams.flat().reduce((sum, player) => sum + player.waitMs, 0) }] : [];
  })).sort((left, right) => right.totalWaitMs - left.totalWaitMs)[0] ?? null;

  const regularSuggestion = choose([
    unlocked.filter((player) => player.line === 'normal'),
    unlocked.filter((player) => player.line === 'winners'),
  ]) ?? choose([unlocked]);
  let best = regularSuggestion;
  for (const [index, group] of lockedGroups.entries()) {
    if (forcedCategory && !group.some((player) => player.category === forcedCategory)) continue;
    const remaining = 4 - group.length;
    const lowerLevel = forcedCategory ? levels[levels.indexOf(forcedCategory) - 1] : undefined;
    const promotedIds = new Set(players.filter((player) => player.category === lowerLevel && player.games >= 5 && player.wins >= 4 && player.wins / player.games >= 0.8).map((player) => player.id));
    const units = [
      ...lockedGroups.filter((_, groupIndex) => groupIndex !== index),
      ...unlocked.map((player) => [player]),
    ].filter((unit) => !forcedCategory || unit.every((player) => player.category === forcedCategory || promotedIds.has(player.id)));
    const fillers = selectUnits(units, remaining);
    if (!fillers) continue;
    const selected = [...group, ...fillers];
    const category = forcedCategory ?? levels.slice().reverse().find((level) => selected.some((player) => player.category === level))!;
    const match = forcedCategory ? suggestOpenPlayMatch(selected, category) : createSuggestion(selected);
    if (!match) continue;
    const suggestion: NextMatchSuggestion = {
      ...match,
      category,
      totalWaitMs: selected.reduce((sum, player) => sum + player.waitMs, 0),
    };
    if (!best || suggestion.totalWaitMs > best.totalWaitMs) best = suggestion;
  }
  return best;
}

interface CategoryPlan {
  players: MatchingPlayer[];
  targetCount: number;
  levelDistance: number;
  urgency: number;
  totalWait: number;
  winRateGap: number;
  lineMask: number;
  positionTotal: number;
}

function suggestForcedCategoryMatch(players: MatchingPlayer[], playerLocks: string[][], forcedCategory: OpenPlayCategory): NextMatchSuggestion | null {
  const targetIndex = levels.indexOf(forcedCategory);
  const positions = new Map(players.map((player, index) => [player.id, index]));
  const averageWait = players.length ? players.reduce((sum, player) => sum + player.waitMs, 0) / players.length : 0;
  const targetRates = players.filter((player) => player.category === forcedCategory && player.games > 0)
    .map((player) => player.wins / player.games);
  const averageTargetRate = targetRates.length ? targetRates.reduce((sum, rate) => sum + rate, 0) / targetRates.length : null;
  const lockedIds = new Set(playerLocks.flat());
  const availableById = new Map(players.map((player) => [player.id, player]));
  const units: MatchingPlayer[][] = playerLocks
    .filter((group) => group.length >= 2 && group.length <= 4 && group.every((id) => availableById.has(id)))
    .map((group) => group.map((id) => availableById.get(id)!));
  units.push(...players.filter((player) => !lockedIds.has(player.id)).map((player) => [player]));

  const addPlayer = (plan: CategoryPlan, player: MatchingPlayer): CategoryPlan => {
    const levelDistance = Math.abs(levels.indexOf(player.category) - targetIndex);
    const winRateGap = averageTargetRate !== null && player.category !== forcedCategory && player.games > 0
      ? Math.abs(player.wins / player.games - averageTargetRate) : 0;
    return {
      players: [...plan.players, player],
      targetCount: plan.targetCount + Number(player.category === forcedCategory),
      levelDistance: plan.levelDistance + levelDistance,
      urgency: plan.urgency + (player.waitMs >= warningMs ? 3 : player.waitMs >= nearWarningMs ? 2 : player.waitMs > averageWait ? 1 : 0),
      totalWait: plan.totalWait + player.waitMs,
      winRateGap: plan.winRateGap + winRateGap,
      lineMask: plan.lineMask | (player.line === 'normal' ? 1 : 2),
      positionTotal: plan.positionTotal + (positions.get(player.id) ?? 0),
    };
  };
  const compare = (left: CategoryPlan, right: CategoryPlan) =>
    right.targetCount - left.targetCount || left.levelDistance - right.levelDistance ||
    right.urgency - left.urgency || right.totalWait - left.totalWait || left.winRateGap - right.winRateGap ||
    Number((left.lineMask & (left.lineMask - 1)) !== 0) - Number((right.lineMask & (right.lineMask - 1)) !== 0) ||
    left.positionTotal - right.positionTotal;
  const plans = new Map<string, CategoryPlan>();
  plans.set('0:0', { players: [], targetCount: 0, levelDistance: 0, urgency: 0, totalWait: 0, winRateGap: 0, lineMask: 0, positionTotal: 0 });
  for (const unit of units) {
    for (const plan of [...plans.values()]) {
      if (plan.players.length + unit.length > 4) continue;
      const extended = unit.reduce(addPlayer, plan);
      const key = `${extended.players.length}:${extended.lineMask}`;
      const existing = plans.get(key);
      if (!existing || compare(extended, existing) < 0) plans.set(key, extended);
    }
  }
  const best = [...plans.values()].filter((plan) => plan.players.length === 4).sort(compare)[0];
  if (!best) return null;
  const suggestionCategory = best.targetCount ? forcedCategory : best.players
    .map((player) => player.category)
    .sort((left, right) => Math.abs(levels.indexOf(left) - targetIndex) - Math.abs(levels.indexOf(right) - targetIndex) || levels.indexOf(right) - levels.indexOf(left))[0];
  return {
    ...createSuggestion(best.players),
    category: suggestionCategory,
    totalWaitMs: best.totalWait,
  };
}

function selectUnits(units: MatchingPlayer[][], capacity: number): MatchingPlayer[] | null {
  const options: Array<{ players: MatchingPlayer[]; waitMs: number } | undefined> = Array(capacity + 1);
  options[0] = { players: [], waitMs: 0 };
  for (const unit of units) {
    if (unit.length > capacity) continue;
    for (let size = capacity; size >= unit.length; size--) {
      const previous = options[size - unit.length];
      if (!previous) continue;
      const players = [...previous.players, ...unit];
      const waitMs = previous.waitMs + unit.reduce((sum, player) => sum + player.waitMs, 0);
      if (!options[size] || waitMs > options[size]!.waitMs) options[size] = { players, waitMs };
    }
  }
  return options[capacity]?.players ?? null;
}

export function suggestOpenPlayMatch(players: MatchingPlayer[], courtCategory: OpenPlayCategory): MatchSuggestion | null {
  if (players.length < 4) return null;
  const positions = new Map(players.map((player, index) => [player.id, index]));
  const totalWait = players.reduce((sum, player) => sum + player.waitMs, 0);
  const priority = (player: MatchingPlayer) => {
    if (player.waitMs >= warningMs) return 3;
    if (player.waitMs >= nearWarningMs) return 2;
    if (players.length > 1 && player.waitMs > (totalWait - player.waitMs) / (players.length - 1)) return 1;
    return 0;
  };
  const compare = (left: MatchingPlayer, right: MatchingPlayer) =>
    priority(right) - priority(left) || (priority(left) ? right.waitMs - left.waitMs : 0) ||
    (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0);
  const sameLevel = players.filter((player) => player.category === courtCategory);
  const lowerLevel = levels[levels.indexOf(courtCategory) - 1];
  const promoted = players.filter((player) => player.category === lowerLevel && player.games >= 5 && player.wins >= 4 && player.wins / player.games >= 0.8);
  const candidates = [...sameLevel, ...promoted].sort(compare);

  for (const anchor of candidates) {
    const sameLine = sameLevel.filter((player) => player.line === anchor.line).sort(compare);
    const otherLine = sameLevel.filter((player) => player.line !== anchor.line).sort(compare);
    if (anchor.category === courtCategory && sameLevel.length >= 4) {
      const pool = sameLine.length >= 4 ? sameLine : [...sameLine, ...otherLine];
      const selected = [anchor, ...pool.filter((player) => player.id !== anchor.id)].slice(0, 4);
      return createSuggestion(selected);
    }
    if (!promoted.length) continue;
    for (const sameLineOnly of [true, false]) {
      const lower = promoted.filter((player) => !sameLineOnly || player.line === anchor.line).sort(compare);
      const topLower = anchor.category === lowerLevel ? anchor : lower[0];
      if (!topLower || (sameLineOnly && topLower.line !== anchor.line)) continue;
      const higher = sameLevel.filter((player) => (!sameLineOnly || player.line === anchor.line) && player.games >= 5 && player.wins / player.games < topLower.wins / topLower.games)
        .sort((left, right) => priority(right) - priority(left) || left.wins / left.games - right.wins / right.games || compare(left, right));
      if (!higher.length || (anchor.category === courtCategory && !higher.some((player) => player.id === anchor.id))) continue;
      const firstHigher = anchor.category === courtCategory ? anchor : higher[0];
      const selected = [topLower, firstHigher];
      const remaining = [...lower, ...higher].filter((player) => !selected.some((entry) => entry.id === player.id))
        .sort((left, right) => priority(right) - priority(left) ||
          (left.category === courtCategory && right.category === courtCategory ? left.wins / left.games - right.wins / right.games : 0) || compare(left, right));
      for (const player of remaining) {
        if (selected.length >= 4) break;
        const higherPlayers = [...selected.filter((entry) => entry.category === courtCategory), ...(player.category === courtCategory ? [player] : [])];
        const lowerPlayers = [...selected.filter((entry) => entry.category === lowerLevel), ...(player.category === lowerLevel ? [player] : [])];
        if (higherPlayers.every((higherPlayer) => lowerPlayers.every((lowerPlayer) => higherPlayer.wins / higherPlayer.games < lowerPlayer.wins / lowerPlayer.games))) selected.push(player);
      }
      if (selected.length === 4) return createSuggestion(selected);
    }
  }
  return null;
}

function createSuggestion(players: MatchingPlayer[]): MatchSuggestion {
  const sorted = [...players].sort((left, right) => levels.indexOf(left.category) - levels.indexOf(right.category));
  return {
    teams: [[sorted[0], sorted[3]], [sorted[1], sorted[2]]],
    mixedLines: new Set(players.map((player) => player.line)).size > 1,
    mixedLevels: new Set(players.map((player) => player.category)).size > 1,
  };
}