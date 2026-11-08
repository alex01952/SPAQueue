import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DefaultAzureCredential } from '@azure/identity';
import { TableClient } from '@azure/data-tables';
import { randomUUID } from 'node:crypto';
import { AppService } from './app.service';
import { isMissingTableEntity } from './azure-table-errors';

export interface OpenPlayPlayer {
  id: string;
  name: string;
  category: 'Novice' | 'Intermediate' | 'High Intermediate';
  memberId: string | null;
  status: 'Not Arrived' | 'Active' | 'Rest' | 'Left';
}

export interface OpenPlayMatchPlayer { id: string; name: string; memberId: string | null; }
export interface OpenPlayCourt { number: number; name: string; category: OpenPlayPlayer['category']; }
export interface OpenPlayBenchClock { accumulatedMs: number; since: string | null; }
export type OpenPlayMatchingMode = 'wait-priority';
const defaultMatchingMode: OpenPlayMatchingMode = 'wait-priority';
export type OpenPlayForcedCategory = OpenPlayPlayer['category'] | null;
export interface OpenPlayMatch {
  id: string;
  teams: OpenPlayMatchPlayer[][];
  status: 'ongoing' | 'completed';
  winner: 1 | 2 | null;
  score: { team1: number; team2: number } | null;
  startedAt: string;
  completedAt: string | null;
  court: OpenPlayCourt | null;
}
export interface OpenPlayDraft {
  players: OpenPlayPlayer[];
  courts: OpenPlayCourt[];
  matches: OpenPlayMatch[];
  queue: string[];
  winnersQueue: string[];
  bench: Record<string, OpenPlayBenchClock>;
  unavailable: string[];
  playerLocks: string[][];
  matchingMode: OpenPlayMatchingMode;
  forcedCategory: OpenPlayForcedCategory;
  nextPlayerIds: string[] | null;
  liveBoardState: OpenPlayLiveBoardState | null;
  session: OpenPlaySessionState | null;
  benchMigrationNeeded: boolean;
  revision: string | null;
  courtNameVersion: 1;
  queueVersion: 4;
}
export interface OpenPlayLiveBoardState {
  matchingMode: OpenPlayMatchingMode;
  forcedCategory: OpenPlayForcedCategory;
  nextPlayerIds: string[] | null;
  playerLocks: string[][];
  unavailable: string[];
}
export interface OpenPlayAwardCandidate {
  memberId: string;
  name: string;
  participated: boolean;
  topFiveRank: number | null;
  participationRequestId: string | null;
  topFiveRequestId: string | null;
}
export interface OpenPlayAwardReview {
  activityDate: string;
  candidates: OpenPlayAwardCandidate[];
  selectedAwardIds: string[];
  awardedAwardIds: string[];
  skipped: boolean;
  completed: boolean;
  completedAt: string | null;
}
export interface OpenPlaySessionState {
  id: string;
  active: boolean;
  startedAt: string;
  endedAt: string | null;
  awardReview: OpenPlayAwardReview | null;
}
export interface OpenPlayHistoryRecord {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  archivedAt: string;
  matches: OpenPlayMatch[];
  topFive: Array<{ memberId: string | null; name: string; category: OpenPlayPlayer['category']; wins: number; losses: number; games: number; percent: number }>;
  awardReview: OpenPlayAwardReview;
}

function hasActiveGoldMembership(expiresOn: string | null, now = Date.now()) {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return false;
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  return Number.isFinite(expiry.getTime()) && expiry.toISOString().slice(0, 10) === expiresOn && now < expiry.getTime() + 86_400_000;
}

@Injectable()
export class OpenPlayService {
  private readonly logger = new Logger(OpenPlayService.name);
  private table?: TableClient;
  private historyTable?: TableClient;

  constructor(private readonly app: AppService) {}

  private getTable() {
    if (!this.table) {
      const account = process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
      if (!account) throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for Open Play.');
      this.table = new TableClient(
        `https://${account}.table.core.windows.net`,
        process.env.OPEN_PLAY_AZURE_TABLE ?? 'OpenPlay',
        new DefaultAzureCredential(),
      );
    }
    return this.table;
  }

  private getHistoryTable() {
    if (!this.historyTable) {
      const account = process.env.MEMBERS_AZURE_STORAGE_ACCOUNT;
      if (!account) throw new BadRequestException('MEMBERS_AZURE_STORAGE_ACCOUNT is required for Open Play history.');
      this.historyTable = new TableClient(
        `https://${account}.table.core.windows.net`,
        process.env.OPEN_PLAY_HISTORY_AZURE_TABLE ?? 'OpenPlayHistory',
        new DefaultAzureCredential(),
      );
    }
    return this.historyTable;
  }

  private async requireAdmin(token: string) {
    const session = await this.app.getMemberSession(token);
    if (session.member.role !== 'admin' && session.member.role !== 'balance-staff') {
      throw new ForbiddenException('Only admins and balance staff can manage Open Play.');
    }
    return session.member;
  }

  getMembers(token: string) {
    return this.app.getOpenPlayMembers(token);
  }

  async getDraft(token: string, adminOnly = true): Promise<OpenPlayDraft> {
    if (adminOnly) await this.requireAdmin(token);
    else await this.app.getMemberSession(token);
    try {
      const entity = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
      const players = this.validatePlayers(JSON.parse(String(entity.Players)) as unknown);
      const playerLocks = this.validatePlayerLocks(entity.PlayerLocks === undefined ? [] : JSON.parse(String(entity.PlayerLocks)) as unknown, players);
      const forcedCategory = this.validateForcedCategory(entity.ForcedCategory);
      const nextPlayerIds = this.validateNextPlayerIds(entity.NextPlayerIds === undefined ? null : JSON.parse(String(entity.NextPlayerIds)) as unknown, players);
      const liveBoardState = this.validateLiveBoardState(entity.LiveBoardState ? JSON.parse(String(entity.LiveBoardState)) as unknown : null, players);
      const session = this.validateSessionState(entity.Session ? JSON.parse(String(entity.Session)) as unknown : null);
      const { queue, winnersQueue } = this.validateQueues(
        entity.Queue === undefined ? undefined : JSON.parse(String(entity.Queue)) as unknown,
        entity.WinnersQueue === undefined ? undefined : JSON.parse(String(entity.WinnersQueue)) as unknown,
        players,
      );
      const courts = this.validateCourts(entity.Courts === undefined ? [] : JSON.parse(String(entity.Courts)) as unknown);
      let serializedMatches = entity.Matches === undefined ? '[]' : String(entity.Matches);
      if (entity.MatchPartCount !== undefined) {
        const count = entity.MatchPartCount;
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 14) throw new Error('Invalid match history parts');
        const parts = Array.from({ length: count }, (_, index) => entity[`MatchPart${index}`]);
        if (parts.some((part) => typeof part !== 'string')) throw new Error('Missing match history part');
        serializedMatches = parts.join('');
      }
      const matches = this.validateMatches(JSON.parse(serializedMatches) as unknown);
      this.validateCourtAssignments(courts, matches);
      const unavailable = this.validateUnavailable(entity.Unavailable === undefined ? [] : JSON.parse(String(entity.Unavailable)) as unknown, players, matches);
      const benchMigrationNeeded = entity.BenchPartCount === undefined;
      let benchInput: unknown;
      if (!benchMigrationNeeded) {
        const count = entity.BenchPartCount;
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 14) throw new Error('Invalid bench clock parts');
        const parts = Array.from({ length: count }, (_, index) => entity[`BenchPart${index}`]);
        if (parts.some((part) => typeof part !== 'string')) throw new Error('Missing bench clock part');
        benchInput = JSON.parse(parts.join('')) as unknown;
      }
      const bench = this.validateBench(benchInput, players, matches);
      const matchingMode = this.validateMatchingMode(entity.MatchingMode);
      if (typeof entity.Revision !== 'string' || !entity.Revision) throw new Error('Invalid draft revision');
      return { players, courts, matches, queue, winnersQueue, bench, unavailable, playerLocks, matchingMode, forcedCategory, nextPlayerIds, liveBoardState, session, benchMigrationNeeded, revision: entity.Revision, courtNameVersion: 1, queueVersion: 4 };
    } catch (error) {
      if (isMissingTableEntity(error)) return { players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [], matchingMode: defaultMatchingMode, forcedCategory: null, nextPlayerIds: null, liveBoardState: null, session: null, benchMigrationNeeded: false, revision: null, courtNameVersion: 1, queueVersion: 4 };
      if (error instanceof BadRequestException && error.message.includes('MEMBERS_AZURE_STORAGE_ACCOUNT')) throw error;
      this.logger.error('Unable to load Open Play draft.', error);
      throw new BadGatewayException('Unable to load the Open Play draft.');
    }
  }

  async getBoard(token: string) {
    const draft = await this.getDraft(token, false);
    const membershipExpiries = await this.app.getOpenPlayGoldMembershipExpiries(token, draft.players.flatMap((player) => player.memberId ? [player.memberId] : []));
    const membershipType = (player: OpenPlayPlayer) => !player.memberId
      ? 'non-member'
      : hasActiveGoldMembership(membershipExpiries[player.memberId] ?? null) ? 'gold-member' : 'member';
    const records = new Map<string, { wins: number; losses: number }>(draft.players.map((player) => [player.id, { wins: 0, losses: 0 }]));
    for (const match of draft.matches) {
      if (match.status !== 'completed' || match.winner === null) continue;
      for (const player of draft.players) {
        const teamIndex = match.teams.findIndex((team) => team.some((participant) =>
          participant.id === player.id || (!!player.memberId && player.memberId === participant.memberId),
        ));
        if (teamIndex < 0) continue;
        const record = records.get(player.id)!;
        if (match.winner === teamIndex + 1) record.wins++;
        else record.losses++;
      }
    }
    const now = Date.now();
    const isPlaying = (player: OpenPlayPlayer) => draft.matches.some((match) => match.status === 'ongoing' && match.teams.some((team) => team.some((participant) =>
      participant.id === player.id || (!!player.memberId && player.memberId === participant.memberId),
    )));
    const line = (ids: string[], lineName: 'normal' | 'winners') => ids.flatMap((id) => {
      const player = draft.players.find((entry) => entry.id === id);
      if (!player || player.status !== 'Active' || isPlaying(player)) return [];
      const record = records.get(player.id)!;
      const clock = draft.bench[player.id] ?? { accumulatedMs: 0, since: null };
      return [{
        id: player.id, name: player.name, category: player.category, line: lineName,
        waitMs: clock.accumulatedMs + (clock.since ? Math.max(0, now - Date.parse(clock.since)) : 0),
        wins: record.wins, losses: record.losses, games: record.wins + record.losses,
        available: !(liveBoardState?.unavailable ?? draft.unavailable).includes(player.id),
        membershipType: membershipType(player),
      }];
    });
    const topFive = draft.players.map((player) => {
      const record = records.get(player.id)!;
      const games = record.wins + record.losses;
      return { id: player.id, name: player.name, ...record, games, percent: games ? record.wins * 100 / games : 0, membershipType: membershipType(player) };
    }).filter((entry) => entry.games > 0)
      .sort((left, right) => right.percent - left.percent || right.wins - left.wins || right.games - left.games || left.name.localeCompare(right.name)).slice(0, 5);
    const liveBoardState = draft.liveBoardState;
    return {
      active: draft.session?.active ?? false,
      regularLine: draft.session?.active ? line(draft.queue, 'normal') : [],
      winnersLine: draft.session?.active ? line(draft.winnersQueue, 'winners') : [],
      topFive: draft.session?.active ? topFive : [],
      playerLocks: liveBoardState?.playerLocks ?? draft.playerLocks,
      matchingMode: liveBoardState?.matchingMode ?? draft.matchingMode,
      forcedCategory: liveBoardState ? liveBoardState.forcedCategory : draft.forcedCategory,
      nextPlayerIds: liveBoardState ? liveBoardState.nextPlayerIds : draft.nextPlayerIds,
      unavailable: liveBoardState?.unavailable ?? draft.unavailable,
      revision: draft.revision,
    };
  }

  async startSession(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('The saved Open Play revision is required.');
    const data = input as Record<string, unknown>;
    if (typeof data.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.revision)) throw new BadRequestException('Invalid draft revision.');
    const existing = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    if (draft.revision !== data.revision || existing.Revision !== data.revision) throw new ConflictException('The Open Play draft changed. Reload before starting.');
    if (draft.session?.active) throw new ConflictException('An Open Play session is already active.');
    if (draft.session?.awardReview && !draft.session.awardReview.completed) throw new ConflictException('Complete or skip the previous session award review before starting another.');
    if (draft.matches.some((match) => match.status === 'ongoing')) throw new BadRequestException('End or cancel every ongoing match before starting Open Play.');
    const startedAt = new Date().toISOString();
    const session: OpenPlaySessionState = { id: randomUUID(), active: true, startedAt, endedAt: null, awardReview: null };
    const activePlayers = draft.players.filter((player) => player.status === 'Active');
    const bench = Object.fromEntries(draft.players.map((player) => [player.id, {
      accumulatedMs: 0, since: player.status === 'Active' ? startedAt : null,
    }]));
    await this.persistSessionState(actor.memberId, existing, session, {
      Matches: '[]', MatchPartCount: 1, MatchPart0: '[]',
      Queue: JSON.stringify(activePlayers.map((player) => player.id)), WinnersQueue: '[]',
      BenchPartCount: 1, BenchPart0: JSON.stringify(bench), Unavailable: '[]',
      NextPlayerIds: 'null', LiveBoardState: '',
    });
    return this.getDraft(token);
  }

  async endSession(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('The saved Open Play revision is required.');
    const data = input as Record<string, unknown>;
    if (typeof data.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.revision)) throw new BadRequestException('Invalid draft revision.');
    const existing = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    if (draft.revision !== data.revision || existing.Revision !== data.revision) throw new ConflictException('The Open Play draft changed. Reload before ending.');
    if (!draft.session?.active) throw new ConflictException('There is no active Open Play session.');
    if (draft.matches.some((match) => match.status === 'ongoing')) throw new BadRequestException('End or cancel every ongoing match before ending Open Play.');

    const participants = new Map<string, string>();
    const records = new Map(draft.players.map((player) => [player.id, { wins: 0, losses: 0 }]));
      for (const player of draft.players) {
        if ((player.status === 'Active' || player.status === 'Rest') && player.memberId) participants.set(player.memberId, player.name);
      }
    for (const match of draft.matches) {
      if (match.status !== 'completed') continue;
      for (const team of match.teams) {
        for (const participant of team) {
          if (participant.memberId) participants.set(participant.memberId, participant.name);
        }
      }
      if (match.winner === null) continue;
      for (const player of draft.players) {
        const teamIndex = match.teams.findIndex((team) => team.some((entry) =>
          entry.id === player.id || (!!player.memberId && player.memberId === entry.memberId),
        ));
        if (teamIndex < 0) continue;
        const record = records.get(player.id)!;
        if (match.winner === teamIndex + 1) record.wins++;
        else record.losses++;
      }
    }
    const ranked = draft.players.map((player) => {
      const record = records.get(player.id)!;
      const games = record.wins + record.losses;
      return { player, ...record, games, percent: games ? record.wins * 100 / games : 0 };
    }).filter((entry) => entry.games > 0)
      .sort((left, right) => right.percent - left.percent || right.wins - left.wins || right.games - left.games || left.player.name.localeCompare(right.player.name))
      .slice(0, 5);
    const rankByMemberId = new Map(ranked.flatMap((entry, index) => entry.player.memberId ? [[entry.player.memberId, index + 1] as const] : []));
    const goldMemberIds = [...new Set([
      ...participants.keys(),
      ...draft.players.flatMap((player) => player.memberId ? [player.memberId] : []),
      ...ranked.flatMap((entry) => entry.player.memberId ? [entry.player.memberId] : []),
    ])];
    const expiries = await this.app.getOpenPlayGoldMembershipExpiries(token, goldMemberIds);
    const candidates: OpenPlayAwardCandidate[] = [];
    for (const memberId of goldMemberIds) {
      if (!hasActiveGoldMembership(expiries[memberId] ?? null)) continue;
      const topFiveRank = rankByMemberId.get(memberId) ?? null;
      const participated = participants.has(memberId);
      candidates.push({
        memberId, name: participants.get(memberId) ?? draft.players.find((player) => player.memberId === memberId)?.name ?? ranked.find((entry) => entry.player.memberId === memberId)!.player.name,
        participated, topFiveRank,
        participationRequestId: randomUUID(),
        topFiveRequestId: topFiveRank !== null ? randomUUID() : null,
      });
    }
    const selectedAwardIds = candidates.flatMap((candidate) => [
      ...(candidate.participated && candidate.participationRequestId ? [`${candidate.memberId}:participation`] : []),
      ...(candidate.topFiveRequestId ? [`${candidate.memberId}:top-five`] : []),
    ]);
    const endedAt = new Date().toISOString();
    const session: OpenPlaySessionState = {
      ...draft.session, active: false, endedAt,
      awardReview: {
        activityDate: this.sessionActivityDate(new Date(endedAt)), candidates, selectedAwardIds,
        awardedAwardIds: [], skipped: false, completed: false, completedAt: null,
      },
    };
    await this.persistSessionState(actor.memberId, existing, session, { LiveBoardState: '' });
    return this.getDraft(token);
  }

  async saveAwardDecision(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Award decisions are required.');
    const data = input as Record<string, unknown>;
    if (typeof data.sessionId !== 'string' || !Array.isArray(data.selectedAwardIds) || typeof data.skip !== 'boolean') throw new BadRequestException('Invalid award decisions.');
    const existing = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    const session = draft.session;
    const review = session?.awardReview;
    if (!session || session.id !== data.sessionId || session.active || !review) throw new ConflictException('The Open Play award review is no longer available.');
    if (review.completed) return draft;
    const eligible = new Set(review.candidates.flatMap((candidate) => [
      ...(candidate.participationRequestId ? [`${candidate.memberId}:participation`] : []),
      ...(candidate.topFiveRequestId ? [`${candidate.memberId}:top-five`] : []),
    ]));
    const selected = data.selectedAwardIds as unknown[];
    if (new Set(selected).size !== selected.length || selected.some((id) => typeof id !== 'string' || !eligible.has(id))) {
      throw new BadRequestException('The selected awards do not match this session review.');
    }
    const skipped = data.skip;
    if (review.awardedAwardIds.some((id) => !skipped && !(selected as string[]).includes(id))) {
      throw new BadRequestException('An award that has already been recorded cannot be excluded.');
    }
    if (skipped && review.awardedAwardIds.length) throw new BadRequestException('Points have already been recorded for this session.');
    const updatedReview: OpenPlayAwardReview = {
      ...review, selectedAwardIds: skipped ? [] : selected as string[], skipped,
      completed: skipped, completedAt: skipped ? new Date().toISOString() : null,
    };
    await this.persistSessionState(actor.memberId, existing, { ...session, awardReview: updatedReview });
    return this.getDraft(token);
  }

  async recordAwardProgress(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Award progress is required.');
    const data = input as Record<string, unknown>;
    if (typeof data.sessionId !== 'string' || typeof data.awardId !== 'string') throw new BadRequestException('Invalid award progress.');
    const existing = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    const session = draft.session;
    const review = session?.awardReview;
    if (!session || session.id !== data.sessionId || !review || review.completed || review.skipped || !review.selectedAwardIds.includes(data.awardId)) {
      throw new ConflictException('This award is no longer selected for the session.');
    }
    if (review.awardedAwardIds.includes(data.awardId)) return draft;
    const updatedReview: OpenPlayAwardReview = { ...review, awardedAwardIds: [...review.awardedAwardIds, data.awardId] };
    await this.persistSessionState(actor.memberId, existing, { ...session, awardReview: updatedReview });
    return this.getDraft(token);
  }

  async completeAwardReview(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as Record<string, unknown>).sessionId !== 'string') {
      throw new BadRequestException('The Open Play session ID is required.');
    }
    const sessionId = (input as Record<string, unknown>).sessionId as string;
    const existing = await this.getTable().getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    const session = draft.session;
    const review = session?.awardReview;
    if (!session || session.id !== sessionId || !review) throw new ConflictException('The Open Play award review is no longer available.');
    if (review.completed) return draft;
    if (review.skipped) throw new ConflictException('This session was closed without awarding points.');
    if (review.selectedAwardIds.some((id) => !review.awardedAwardIds.includes(id))) throw new ConflictException('All selected point awards must be recorded before completing the review.');
    const updatedReview: OpenPlayAwardReview = { ...review, awardedAwardIds: [...review.selectedAwardIds], completed: true, completedAt: new Date().toISOString() };
    await this.persistSessionState(actor.memberId, existing, { ...session, awardReview: updatedReview });
    return this.getDraft(token);
  }

  async archiveSession(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('The completed session is required.');
    const data = input as Record<string, unknown>;
    if (typeof data.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.sessionId) || typeof data.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.revision)) {
      throw new BadRequestException('Invalid Open Play archive request.');
    }
    const table = this.getTable();
    const existing = await table.getEntity<Record<string, unknown>>('drafts', 'current');
    const draft = await this.getDraft(token);
    if (!draft.session && existing.Session === 'null') {
      try {
        const prior = await this.getHistoryTable().getEntity<Record<string, unknown>>('sessions', data.sessionId);
        if (prior.SessionId === data.sessionId) return draft;
      } catch (error) {
        if (!isMissingTableEntity(error)) throw error;
      }
    }
    if (!draft.session || draft.session.id !== data.sessionId || draft.session.active || !draft.session.endedAt ||
      !draft.session.awardReview?.completed || draft.revision !== data.revision || existing.Revision !== data.revision) {
      throw new ConflictException('Only a completed, reviewed Open Play session can be archived. Reload and try again.');
    }
    if (draft.matches.some((match) => match.status === 'ongoing')) throw new BadRequestException('End or cancel every ongoing match before archiving.');

    const records = new Map(draft.players.map((player) => [player.id, { wins: 0, losses: 0 }]));
    for (const match of draft.matches) {
      if (match.status !== 'completed' || match.winner === null) continue;
      for (const player of draft.players) {
        const teamIndex = match.teams.findIndex((team) => team.some((entry) => entry.id === player.id || (!!player.memberId && player.memberId === entry.memberId)));
        if (teamIndex < 0) continue;
        const record = records.get(player.id)!;
        if (match.winner === teamIndex + 1) record.wins++;
        else record.losses++;
      }
    }
    const topFive = draft.players.map((player) => {
      const record = records.get(player.id)!;
      const games = record.wins + record.losses;
      return { memberId: player.memberId, name: player.name, category: player.category, ...record, games, percent: games ? record.wins * 100 / games : 0 };
    }).filter((entry) => entry.games > 0)
      .sort((left, right) => right.percent - left.percent || right.wins - left.wins || right.games - left.games || left.name.localeCompare(right.name)).slice(0, 5);
    const serializedMatches = JSON.stringify(draft.matches);
    const matchParts: string[] = [];
    for (let start = 0; start < serializedMatches.length;) {
      let end = Math.min(start + 30000, serializedMatches.length);
      if (end < serializedMatches.length && /[\uD800-\uDBFF]/.test(serializedMatches[end - 1])) end--;
      matchParts.push(serializedMatches.slice(start, end));
      start = end;
    }
    const history = this.getHistoryTable();
    const archiveEntity = {
      partitionKey: 'sessions', rowKey: draft.session.id, SessionId: draft.session.id,
      StartedAt: draft.session.startedAt, EndedAt: draft.session.endedAt, ArchivedAt: new Date().toISOString(), ArchivedBy: actor.memberId,
      TopFive: JSON.stringify(topFive), AwardReview: JSON.stringify(draft.session.awardReview), MatchPartCount: matchParts.length,
      ...Object.fromEntries(matchParts.map((part, index) => [`MatchPart${index}`, part])),
    };
    try {
      await history.createEntity(archiveEntity);
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 409)) throw error;
      const prior = await history.getEntity<Record<string, unknown>>('sessions', draft.session.id);
      if (prior.SessionId !== draft.session.id) throw new ConflictException('An archive with this session ID already exists.');
    }

    const revision = randomUUID();
    const cleared = {
      partitionKey: 'drafts', rowKey: 'current', Players: '[]', Queue: '[]', WinnersQueue: '[]', Unavailable: '[]',
      PlayerLocks: '[]', NextPlayerIds: 'null', Courts: JSON.stringify(draft.courts), MatchingMode: draft.matchingMode,
      ForcedCategory: '', LiveBoardState: '', Session: 'null', MatchPartCount: 1, MatchPart0: '[]',
      BenchPartCount: 1, BenchPart0: '{}', Revision: revision, UpdatedAt: new Date().toISOString(), UpdatedBy: actor.memberId,
    };
    try {
      await table.updateEntity(cleared, 'Replace', { etag: existing.etag });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error && (error.statusCode === 409 || error.statusCode === 412)) {
        throw new ConflictException('The session was archived, but the live roster changed before it could be cleared. Reload and archive again to finish clearing it.');
      }
      throw error;
    }
    return this.getDraft(token);
  }

  private sessionActivityDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }

  private async persistSessionState(actorId: string, existing: Record<string, unknown>, session: OpenPlaySessionState, extra: Record<string, unknown> = {}) {
    if (typeof existing.etag !== 'string') throw new ConflictException('The Open Play draft changed. Reload before continuing.');
    const revision = randomUUID();
    try {
      await this.getTable().updateEntity({
        partitionKey: 'drafts', rowKey: 'current', Session: JSON.stringify(session), Revision: revision,
        UpdatedAt: new Date().toISOString(), UpdatedBy: actorId, ...extra,
      }, 'Merge', { etag: existing.etag });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error && (error.statusCode === 409 || error.statusCode === 412)) {
        throw new ConflictException('The Open Play draft changed. Reload before continuing.');
      }
      throw error;
    }
    return revision;
  }

  async publishBoardState(token: string, input: unknown) {
    await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Board settings are required.');
    const data = input as Record<string, unknown>;
    if (typeof data.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.revision)) throw new BadRequestException('Invalid draft revision.');
    const table = this.getTable();
    const existing = await table.getEntity<Record<string, unknown>>('drafts', 'current');
    if (existing.Revision !== data.revision || typeof existing.etag !== 'string') throw new ConflictException('The Open Play draft changed. Reload before publishing the board.');
    const players = this.validatePlayers(JSON.parse(String(existing.Players)) as unknown);
    const liveBoardState = this.validateLiveBoardState({
      matchingMode: data.matchingMode,
      forcedCategory: data.forcedCategory,
      nextPlayerIds: data.nextPlayerIds,
      playerLocks: data.playerLocks,
      unavailable: data.unavailable,
    }, players);
    if (!liveBoardState) throw new BadRequestException('Board settings are required.');
    try {
      await table.updateEntity({ partitionKey: 'drafts', rowKey: 'current', LiveBoardState: JSON.stringify(liveBoardState) }, 'Merge', { etag: existing.etag });
      return liveBoardState;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error && (error.statusCode === 409 || error.statusCode === 412)) {
        throw new ConflictException('The Open Play draft changed. Reload before publishing the board.');
      }
      throw error;
    }
  }

  async saveDraft(token: string, input: unknown) {
    const actor = await this.requireAdmin(token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('A draft is required.');
    const data = input as Record<string, unknown>;
    if (data.revision !== null && (typeof data.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.revision))) {
      throw new BadRequestException('Invalid draft revision.');
    }
    const players = this.validatePlayers(data.players);
    const { queue, winnersQueue } = this.validateQueues(data.queue, data.winnersQueue, players);
    const courts = this.validateCourts(data.courts ?? []);
    const serialized = JSON.stringify(players);
    if (serialized.length > 30000) throw new BadRequestException('The player list is too large.');
    const matches = this.validateMatches(data.matches ?? []);
    this.validateCourtAssignments(courts, matches);
    const unavailable = this.validateUnavailable(data.unavailable ?? [], players, matches);
    const playerLocks = this.validatePlayerLocks(data.playerLocks ?? [], players);
    const bench = this.validateBench(data.bench, players, matches);
    const matchingMode = this.validateMatchingMode(data.matchingMode);
    const forcedCategory = this.validateForcedCategory(data.forcedCategory);
    let nextPlayerIds = this.validateNextPlayerIds(data.nextPlayerIds, players);
    const serializedBench = JSON.stringify(bench);
    if (serializedBench.length > 400000) throw new BadRequestException('The bench clock data is too large.');
    const benchParts: string[] = [];
    for (let start = 0; start < serializedBench.length; start += 30000) benchParts.push(serializedBench.slice(start, start + 30000));
    const serializedMatches = JSON.stringify(matches);
    if (serializedMatches.length > 400000) throw new BadRequestException('The match history is too large.');
    const parts: string[] = [];
    for (let start = 0; start < serializedMatches.length;) {
      let end = Math.min(start + 30000, serializedMatches.length);
      if (end < serializedMatches.length && /[\uD800-\uDBFF]/.test(serializedMatches[end - 1])) end--;
      parts.push(serializedMatches.slice(start, end));
      start = end;
    }
    const revision = randomUUID();
    let sessionState: OpenPlaySessionState | null = null;
    const entity = {
      partitionKey: 'drafts', rowKey: 'current', Players: serialized, Queue: JSON.stringify(queue), WinnersQueue: JSON.stringify(winnersQueue), Unavailable: JSON.stringify(unavailable), PlayerLocks: JSON.stringify(playerLocks), NextPlayerIds: JSON.stringify(nextPlayerIds), Courts: JSON.stringify(courts), MatchingMode: matchingMode, ForcedCategory: forcedCategory ?? '', LiveBoardState: '', Session: JSON.stringify(sessionState), MatchPartCount: parts.length, BenchPartCount: benchParts.length, Revision: revision,
      ...Object.fromEntries(parts.map((part, index) => [`MatchPart${index}`, part])),
      ...Object.fromEntries(benchParts.map((part, index) => [`BenchPart${index}`, part])),
      UpdatedAt: new Date().toISOString(), UpdatedBy: actor.memberId,
    };
    try {
      const table = this.getTable();
      if (data.revision === null) {
        await table.createEntity(entity);
      } else {
        const existing = await table.getEntity<Record<string, unknown>>('drafts', 'current');
        if (existing.Revision !== data.revision || !existing.etag) throw new ConflictException('The Open Play draft changed. Reload before saving.');
        sessionState = this.validateSessionState(existing.Session ? JSON.parse(String(existing.Session)) as unknown : null);
        entity.Session = JSON.stringify(sessionState);
        if ((existing.Matches !== undefined || existing.MatchPartCount !== undefined) && data.matches === undefined) throw new BadRequestException('Match history is required when saving.');
        if (existing.Courts !== undefined && data.courts === undefined) throw new BadRequestException('Court configuration is required when saving.');
        if (existing.Queue !== undefined && data.queue === undefined) throw new BadRequestException('Player line is required when saving.');
        if (existing.WinnersQueue !== undefined && data.winnersQueue === undefined) throw new BadRequestException('Winners line is required when saving.');
        if (existing.BenchPartCount !== undefined && data.bench === undefined) throw new BadRequestException('Bench clocks are required when saving.');
        if (existing.Unavailable !== undefined && data.unavailable === undefined) throw new BadRequestException('Player availability is required when saving.');
        if (data.playerLocks === undefined && existing.PlayerLocks !== undefined && JSON.parse(String(existing.PlayerLocks)).length) {
          throw new BadRequestException('Player locks are required when saving.');
        }
        if (data.nextPlayerIds === undefined && existing.NextPlayerIds !== undefined) {
          const savedSlots = this.validateNextPlayerIds(JSON.parse(String(existing.NextPlayerIds)) as unknown, players);
          const activeIds = new Set(players.filter((player) => player.status === 'Active').map((player) => player.id));
          nextPlayerIds = savedSlots?.map((id) => id && activeIds.has(id) ? id : '') ?? null;
          entity.NextPlayerIds = JSON.stringify(nextPlayerIds);
        }
        if (data.matchingMode === undefined && existing.MatchingMode !== undefined) entity.MatchingMode = this.validateMatchingMode(existing.MatchingMode);
        if (data.forcedCategory === undefined && existing.ForcedCategory !== undefined) entity.ForcedCategory = this.validateForcedCategory(existing.ForcedCategory) ?? '';
        await table.updateEntity(entity, 'Replace', { etag: existing.etag });
      }
      return { players, courts, matches, queue, winnersQueue, bench, unavailable, playerLocks, matchingMode: entity.MatchingMode, forcedCategory: entity.ForcedCategory === '' ? null : entity.ForcedCategory, nextPlayerIds, liveBoardState: null, session: sessionState, benchMigrationNeeded: false, revision, courtNameVersion: 1, queueVersion: 4 };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (typeof error === 'object' && error !== null && 'statusCode' in error && (error.statusCode === 409 || error.statusCode === 412 || isMissingTableEntity(error))) {
        throw new ConflictException('The Open Play draft changed. Reload before saving.');
      }
      if (error instanceof BadRequestException) throw error;
      this.logger.error('Unable to save Open Play draft.', error);
      throw new BadGatewayException('Unable to save the Open Play draft.');
    }
  }

  private validatePlayers(value: unknown): OpenPlayPlayer[] {
    if (!Array.isArray(value) || value.length > 250) throw new BadRequestException('The player list must contain at most 250 players.');
    const ids = new Set<string>();
    const memberIds = new Set<string>();
    return value.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid player.');
      const player = item as Record<string, unknown>;
      if (typeof player.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(player.id) || ids.has(player.id) ||
        typeof player.name !== 'string' || !player.name.trim() || player.name.trim().length > 200 ||
        !['Novice', 'Intermediate', 'High Intermediate'].includes(String(player.category)) ||
        (player.status !== undefined && !['Not Arrived', 'Active', 'Rest', 'Left'].includes(String(player.status))) ||
        (player.memberId !== null && (typeof player.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(player.memberId) || memberIds.has(player.memberId)))) {
        throw new BadRequestException('Invalid or duplicate player.');
      }
      ids.add(player.id);
      if (typeof player.memberId === 'string') memberIds.add(player.memberId);
      return { id: player.id, name: player.name.trim(), category: player.category as OpenPlayPlayer['category'], memberId: player.memberId as string | null, status: (player.status ?? 'Active') as OpenPlayPlayer['status'] };
    });
  }

  private validateQueues(normal: unknown, winners: unknown, players: OpenPlayPlayer[]) {
    const active = players.filter((player) => player.status === 'Active').map((player) => player.id);
    const queue = normal === undefined ? active : normal;
    const winnersQueue = winners === undefined ? [] : winners;
    if (!Array.isArray(queue) || !Array.isArray(winnersQueue)) throw new BadRequestException('Invalid player lines.');
    const combined = [...queue, ...winnersQueue];
    if (combined.length !== active.length ||
      combined.some((id) => typeof id !== 'string' || !active.includes(id)) || new Set(combined).size !== combined.length) {
      throw new BadRequestException('Player lines must contain each active player exactly once.');
    }
    return { queue: queue as string[], winnersQueue: winnersQueue as string[] };
  }

  private validateMatchingMode(value: unknown): OpenPlayMatchingMode {
    if (value === undefined) return defaultMatchingMode;
    if (value !== defaultMatchingMode) throw new BadRequestException('Invalid Open Play matching mode.');
    return value;
  }

  private validateForcedCategory(value: unknown): OpenPlayForcedCategory {
    if (value === undefined || value === null || value === '') return null;
    if (value !== 'Novice' && value !== 'Intermediate' && value !== 'High Intermediate') {
      throw new BadRequestException('Invalid forced Open Play category.');
    }
    return value;
  }

  private validatePlayerLocks(value: unknown, players: OpenPlayPlayer[]): string[][] {
    if (!Array.isArray(value)) throw new BadRequestException('Invalid player locks.');
    const playerIds = new Set(players.map((player) => player.id));
    const lockedIds = new Set<string>();
    return value.map((group: unknown) => {
      if (!Array.isArray(group) || group.length < 2 || group.length > 4 || new Set(group).size !== group.length || group.some((id) =>
        typeof id !== 'string' || !playerIds.has(id) || lockedIds.has(id),
      )) throw new BadRequestException('Player locks must contain 2 to 4 distinct roster players, with no overlapping locks.');
      group.forEach((id) => lockedIds.add(id as string));
      return group as string[];
    });
  }

  private validateNextPlayerIds(value: unknown, players: OpenPlayPlayer[]): string[] | null {
    if (value === undefined || value === null) return null;
    const activeIds = new Set(players.filter((player) => player.status === 'Active').map((player) => player.id));
    if (!Array.isArray(value) || value.length !== 4 || value.some((id) => typeof id !== 'string' || (id !== '' && !activeIds.has(id))) ||
      new Set(value.filter((id) => id !== '')).size !== value.filter((id) => id !== '').length) {
      throw new BadRequestException('Next Players must contain four unique active roster slots.');
    }
    return value as string[];
  }

  private validateLiveBoardState(value: unknown, players: OpenPlayPlayer[]): OpenPlayLiveBoardState | null {
    if (value === undefined || value === null || value === '') return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid live board settings.');
    const state = value as Record<string, unknown>;
    return {
      matchingMode: this.validateMatchingMode(state.matchingMode),
      forcedCategory: this.validateForcedCategory(state.forcedCategory),
      nextPlayerIds: this.validateNextPlayerIds(state.nextPlayerIds, players),
      playerLocks: this.validatePlayerLocks(state.playerLocks, players),
      unavailable: this.validateLiveUnavailable(state.unavailable, players),
    };
  }

  private validateLiveUnavailable(value: unknown, players: OpenPlayPlayer[]): string[] {
    const activeIds = new Set(players.filter((player) => player.status === 'Active').map((player) => player.id));
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((id) => typeof id !== 'string' || !activeIds.has(id))) {
      throw new BadRequestException('Invalid live board availability.');
    }
    return value as string[];
  }

  private validateSessionState(value: unknown): OpenPlaySessionState | null {
    if (value === undefined || value === null || value === '') return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid Open Play session state.');
    const state = value as Record<string, unknown>;
    if (typeof state.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(state.id) || typeof state.active !== 'boolean' ||
      typeof state.startedAt !== 'string' || !Number.isFinite(Date.parse(state.startedAt)) ||
      (state.endedAt !== null && (typeof state.endedAt !== 'string' || !Number.isFinite(Date.parse(state.endedAt))))) {
      throw new BadRequestException('Invalid Open Play session state.');
    }
    let awardReview: OpenPlayAwardReview | null = null;
    if (state.awardReview !== null) {
      if (!state.awardReview || typeof state.awardReview !== 'object' || Array.isArray(state.awardReview)) throw new BadRequestException('Invalid Open Play award review.');
      const input = state.awardReview as Record<string, unknown>;
      const date = typeof input.activityDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.activityDate) ? new Date(`${input.activityDate}T00:00:00Z`) : null;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.activityDate ||
        !Array.isArray(input.candidates) || input.candidates.length > 250 || !Array.isArray(input.selectedAwardIds) || !Array.isArray(input.awardedAwardIds) ||
        typeof input.skipped !== 'boolean' || typeof input.completed !== 'boolean' ||
        (input.completedAt !== null && (typeof input.completedAt !== 'string' || !Number.isFinite(Date.parse(input.completedAt))))) {
        throw new BadRequestException('Invalid Open Play award review.');
      }
      const candidates = input.candidates.map((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new BadRequestException('Invalid Open Play award candidate.');
        const row = candidate as Record<string, unknown>;
        if (typeof row.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(row.memberId) || typeof row.name !== 'string' ||
          typeof row.participated !== 'boolean' || (row.topFiveRank !== null && (!Number.isInteger(row.topFiveRank) || Number(row.topFiveRank) < 1 || Number(row.topFiveRank) > 5)) ||
          (row.participationRequestId !== null && (typeof row.participationRequestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.participationRequestId))) ||
          (row.topFiveRequestId !== null && (typeof row.topFiveRequestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.topFiveRequestId)))) {
          throw new BadRequestException('Invalid Open Play award candidate.');
        }
        return row as unknown as OpenPlayAwardCandidate;
      });
      const eligible = new Set(candidates.flatMap((candidate) => [
        ...(candidate.participationRequestId ? [`${candidate.memberId}:participation`] : []),
        ...(candidate.topFiveRequestId ? [`${candidate.memberId}:top-five`] : []),
      ]));
      const selectedAwardIds = input.selectedAwardIds as string[];
      const awardedAwardIds = input.awardedAwardIds as string[];
      if (new Set(selectedAwardIds).size !== selectedAwardIds.length || selectedAwardIds.some((id) => !eligible.has(id)) ||
        new Set(awardedAwardIds).size !== awardedAwardIds.length || awardedAwardIds.some((id) => !eligible.has(id))) {
        throw new BadRequestException('Invalid Open Play award selection.');
      }
      awardReview = {
        activityDate: input.activityDate as string, candidates, selectedAwardIds, awardedAwardIds,
        skipped: input.skipped, completed: input.completed, completedAt: input.completedAt as string | null,
      };
    }
    return { id: state.id, active: state.active, startedAt: state.startedAt, endedAt: state.endedAt as string | null, awardReview };
  }

  private validateBench(value: unknown, players: OpenPlayPlayer[], matches: OpenPlayMatch[]): Record<string, OpenPlayBenchClock> {
    const now = new Date().toISOString();
    const playing = (player: OpenPlayPlayer) => matches.some((match) => match.status === 'ongoing' && match.teams.some((team) => team.some((entry) =>
      entry.id === player.id || (!!player.memberId && player.memberId === entry.memberId),
    )));
    if (value === undefined) return Object.fromEntries(players.map((player) => [player.id, {
      accumulatedMs: 0, since: player.status === 'Active' && !playing(player) ? now : null,
    }]));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== players.length) throw new BadRequestException('Invalid bench clocks.');
    const clocks = value as Record<string, unknown>;
    return Object.fromEntries(players.map((player) => {
      const clock = Object.prototype.hasOwnProperty.call(clocks, player.id) ? clocks[player.id] : null;
      if (!clock || typeof clock !== 'object' || Array.isArray(clock)) throw new BadRequestException('Invalid bench clock.');
      const item = clock as Record<string, unknown>;
      const waiting = player.status === 'Active' && !playing(player);
      if (typeof item.accumulatedMs !== 'number' || !Number.isSafeInteger(item.accumulatedMs) || item.accumulatedMs < 0 ||
        (waiting ? typeof item.since !== 'string' || !Number.isFinite(Date.parse(item.since)) : item.since !== null)) {
        throw new BadRequestException('Invalid bench clock.');
      }
      return [player.id, { accumulatedMs: item.accumulatedMs, since: item.since as string | null }];
    }));
  }

  private validateUnavailable(value: unknown, players: OpenPlayPlayer[], matches: OpenPlayMatch[]): string[] {
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((id) => {
      const player = players.find((entry) => entry.id === id);
      return typeof id !== 'string' || !player || player.status !== 'Active' || matches.some((match) =>
        match.status === 'ongoing' && match.teams.some((team) => team.some((entry) =>
          entry.id === player.id || (!!player.memberId && player.memberId === entry.memberId),
        )),
      );
    })) throw new BadRequestException('Invalid unavailable players.');
    return value as string[];
  }

  private validateMatches(value: unknown): OpenPlayMatch[] {
    if (!Array.isArray(value) || value.length > 250) throw new BadRequestException('The match history must contain at most 250 matches.');
    const matchIds = new Set<string>();
    const ongoingPlayers = new Set<string>();
    return value.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid match.');
      const match = item as Record<string, unknown>;
      if (typeof match.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(match.id) || matchIds.has(match.id) ||
        !Array.isArray(match.teams) || match.teams.length !== 2 || !match.teams.every((team: unknown) => Array.isArray(team) && team.length === 2) ||
        !['ongoing', 'completed'].includes(String(match.status)) || typeof match.startedAt !== 'string' || !Number.isFinite(Date.parse(match.startedAt))) {
        throw new BadRequestException('Invalid match.');
      }
      matchIds.add(match.id);
      const ids = new Set<string>();
      const memberIds = new Set<string>();
      const teams: OpenPlayMatchPlayer[][] = (match.teams as unknown[][]).map((team) => team.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid match player.');
        const player = value as Record<string, unknown>;
        if (typeof player.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(player.id) || ids.has(player.id) ||
          typeof player.name !== 'string' || !player.name.trim() || player.name.trim().length > 200 ||
          (player.memberId !== null && (typeof player.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(player.memberId) || memberIds.has(player.memberId)))) {
          throw new BadRequestException('Invalid or duplicate match player.');
        }
        ids.add(player.id);
        if (typeof player.memberId === 'string') memberIds.add(player.memberId);
        if (match.status === 'ongoing') {
          const identity = typeof player.memberId === 'string' ? `member:${player.memberId}` : `player:${player.id}`;
          if (ongoingPlayers.has(identity)) throw new BadRequestException('A player cannot be in multiple ongoing matches.');
          ongoingPlayers.add(identity);
        }
        return { id: player.id, name: player.name.trim(), memberId: player.memberId as string | null };
      }));
      let score: OpenPlayMatch['score'] = null;
      if (match.score !== null) {
        if (!match.score || typeof match.score !== 'object' || Array.isArray(match.score)) throw new BadRequestException('Invalid match score.');
        const input = match.score as Record<string, unknown>;
        if (typeof input.team1 !== 'number' || typeof input.team2 !== 'number' || !Number.isSafeInteger(input.team1) || !Number.isSafeInteger(input.team2) || input.team1 < 0 || input.team2 < 0 || input.team1 > 999 || input.team2 > 999 || input.team1 === input.team2 || (input.team1 > input.team2 ? 1 : 2) !== match.winner) {
          throw new BadRequestException('Scores must be different and match the winning team.');
        }
        score = { team1: input.team1, team2: input.team2 };
      }
      if (match.status === 'ongoing' ? (match.winner !== null || match.score !== null || match.completedAt !== null) :
        ((match.winner !== null && match.winner !== 1 && match.winner !== 2) || typeof match.completedAt !== 'string' || !Number.isFinite(Date.parse(match.completedAt)))) {
        throw new BadRequestException('Invalid match result.');
      }
      const court = match.court == null ? null : this.validateCourts([match.court])[0];
      return { id: match.id, teams, status: match.status as OpenPlayMatch['status'], winner: match.winner as OpenPlayMatch['winner'], score, startedAt: match.startedAt, completedAt: match.completedAt as string | null, court };
    });
  }

  private validateCourts(value: unknown): OpenPlayCourt[] {
    if (!Array.isArray(value) || value.length > 32) throw new BadRequestException('Configure at most 32 courts.');
    const numbers = new Set<number>();
    return value.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid court.');
      const court = item as Record<string, unknown>;
      if (typeof court.number !== 'number' || !Number.isInteger(court.number) || court.number < 1 || court.number > 32 || numbers.has(court.number) ||
        !['Novice', 'Intermediate', 'High Intermediate'].includes(String(court.category)) ||
        (court.name !== undefined && (typeof court.name !== 'string' || !court.name.trim() || court.name.trim().length > 100))) {
        throw new BadRequestException('Invalid or duplicate court.');
      }
      numbers.add(court.number);
      return { number: court.number, name: typeof court.name === 'string' ? court.name.trim() : `Court ${court.number}`, category: court.category as OpenPlayCourt['category'] };
    }).sort((left, right) => left.number - right.number);
  }

  private validateCourtAssignments(courts: OpenPlayCourt[], matches: OpenPlayMatch[]) {
    const occupied = new Set<number>();
    for (const match of matches) {
      if (match.status !== 'ongoing' || !match.court) continue;
      const court = courts.find((candidate) => candidate.number === match.court?.number);
      if (!court || court.category !== match.court.category || occupied.has(court.number)) {
        throw new BadRequestException('An occupied court cannot be removed, recategorized, or assigned to another match.');
      }
      occupied.add(court.number);
    }
  }
}