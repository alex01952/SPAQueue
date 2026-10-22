import { randomUUID } from 'node:crypto';
import { randomizeTournamentPools } from './tournament-scheduling';
import type { TournamentDraw, TournamentPool } from './tournament-scheduling';
import type { TournamentRoster } from './app.service';

export const LIVE_REVEAL_MS = 10_000;
export const LIVE_VOTING_MS = 60_000;
export const LIVE_RESULTS_MS = 10_000;
export const LIVE_PRESENCE_MS = 15_000;
export type LiveDrawPhase = 'scheduled' | 'revealing' | 'voting' | 'results' | 'rerolling' | 'final' | 'invalidated';

export interface LiveDrawEvent {
  eventId: string;
  scheduledAt: number;
  poolCount: number;
  rosterSignature: string;
  roster: TournamentRoster;
  createdBy: string;
  presence: Record<string, number>;
  eligibleMemberIds: string[] | null;
  rerollVoterIds: string[];
  initialDraw: TournamentDraw | null;
  rerollDraw: TournamentDraw | null;
  invalidated: boolean;
}

export interface LiveDrawView {
  eventId: string;
  scheduledAt: string;
  phase: LiveDrawPhase;
  phaseEndsAt: string | null;
  poolCount: number;
  attendeeCount: number;
  eligibleCount: number | null;
  majorityRequired: number | null;
  canVote: boolean;
  hasVoted: boolean;
  pools: TournamentPool[] | null;
  voteResult: { rerollVotes: number; didNotVote: number; reroll: boolean } | null;
}

export function liveDrawTimes(event: LiveDrawEvent) {
  const votingAt = event.scheduledAt + LIVE_REVEAL_MS;
  const resultsAt = votingAt + LIVE_VOTING_MS;
  const decisionAt = resultsAt + LIVE_RESULTS_MS;
  return { votingAt, resultsAt, decisionAt, rerollEndsAt: decisionAt + LIVE_REVEAL_MS };
}

export function liveRerollApproved(event: LiveDrawEvent): boolean {
  const count = event.eligibleMemberIds?.length ?? 0;
  return count > 0 && event.rerollVoterIds.length >= Math.floor(count / 2) + 1;
}

export function liveDrawPhase(event: LiveDrawEvent, now: number): LiveDrawPhase {
  if (event.invalidated) return 'invalidated';
  const times = liveDrawTimes(event);
  if (now < event.scheduledAt) return 'scheduled';
  if (now < times.votingAt) return 'revealing';
  if (now < times.resultsAt) return 'voting';
  if (now < times.decisionAt) return 'results';
  if (liveRerollApproved(event) && now < times.rerollEndsAt) return 'rerolling';
  return 'final';
}

export function advanceLiveDraw(event: LiveDrawEvent, now: number): void {
  if (event.invalidated || now < event.scheduledAt) return;
  if (!event.eligibleMemberIds) {
    const participants = new Set(event.roster.teams.flatMap((team) => team.players.map((player) => player.memberId)));
    event.eligibleMemberIds = Object.entries(event.presence)
      .filter(([id, seenAt]) => participants.has(id) &&
        seenAt < event.scheduledAt && seenAt >= event.scheduledAt - LIVE_PRESENCE_MS)
      .map(([id]) => id).sort();
    event.initialDraw = createLivePoolDraw(event, event.scheduledAt);
    event.presence = {};
  }
  // The second randomization cannot happen until everyone has had a results-only interval.
  if (now >= liveDrawTimes(event).decisionAt && liveRerollApproved(event) && !event.rerollDraw) {
    event.rerollDraw = createLivePoolDraw(event, liveDrawTimes(event).decisionAt);
  }
}

function createLivePoolDraw(event: LiveDrawEvent, at: number): TournamentDraw {
  return {
    version: randomUUID(), rosterSignature: event.rosterSignature,
    pools: randomizeTournamentPools(event.roster.teams.map((team) => team.registrationId), event.poolCount),
    courtCount: 1, schedule: [], updatedAt: new Date(at).toISOString(), updatedBy: event.createdBy,
  };
}

export function toLiveDrawView(event: LiveDrawEvent, memberId: string, now: number): LiveDrawView {
  const phase = liveDrawPhase(event, now);
  const times = liveDrawTimes(event);
  const eligibleCount = event.eligibleMemberIds?.length ?? null;
  const resultsVisible = ['results', 'rerolling', 'final'].includes(phase);
  const hasVoted = event.rerollVoterIds.includes(memberId);
  const endsAt: Partial<Record<LiveDrawPhase, number>> = {
    scheduled: event.scheduledAt, revealing: times.votingAt, voting: times.resultsAt,
    results: times.decisionAt, rerolling: times.rerollEndsAt,
  };
  return {
    eventId: event.eventId, scheduledAt: new Date(event.scheduledAt).toISOString(),
    phase, phaseEndsAt: endsAt[phase] ? new Date(endsAt[phase]!).toISOString() : null,
    poolCount: event.poolCount,
    attendeeCount: eligibleCount ?? Object.values(event.presence).filter((seenAt) => seenAt >= now - LIVE_PRESENCE_MS).length,
    eligibleCount, majorityRequired: eligibleCount === null ? null : Math.floor(eligibleCount / 2) + 1,
    canVote: phase === 'voting' && !!event.eligibleMemberIds?.includes(memberId) && !hasVoted,
    hasVoted,
    pools: ['voting', 'results'].includes(phase) ? event.initialDraw?.pools ?? null
      : phase === 'final' ? (event.rerollDraw ?? event.initialDraw)?.pools ?? null : null,
    voteResult: resultsVisible ? {
      rerollVotes: event.rerollVoterIds.length,
      didNotVote: (eligibleCount ?? 0) - event.rerollVoterIds.length,
      reroll: liveRerollApproved(event),
    } : null,
  };
}
