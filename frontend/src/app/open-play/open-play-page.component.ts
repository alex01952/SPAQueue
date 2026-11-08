import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map, timeout, timer } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { AuthenticatedMember } from '../member-auth.service';
import { isGoldMembershipActive } from '../gold-membership';
import { MemberProfileFrameComponent } from '../member-profile/member-profile-frame.component';
import { BenchClock, benchMilliseconds, categoryFromSkills, formatBenchTime, OpenPlayCategory, parseParticipants, pauseBench, resumeBench, timeSinceGame } from './open-play-players';
import { defaultMatchingMode, isMatchingMode, MatchingMode, matchingModeOptions, MatchingPlayer, suggestNextOpenPlayMatch, suggestOpenPlayMatch } from './open-play-matching';

type OpenPlayMember = Pick<AuthenticatedMember, 'memberId' | 'name' | 'reClubId' | 'skills' | 'goldMembershipExpiresOn'>;
interface Player {
  id: string;
  name: string;
  category: OpenPlayCategory;
  memberId: string | null;
  status: PlayerStatus;
}
type PlayerStatus = 'Not Arrived' | 'Active' | 'Rest' | 'Left';
interface MatchPlayer { id: string; name: string; memberId: string | null; }
interface Court { number: number; name: string; category: OpenPlayCategory; }
interface Match {
  id: string;
  teams: MatchPlayer[][];
  status: 'ongoing' | 'completed';
  winner: 1 | 2 | null;
  score: { team1: number; team2: number } | null;
  startedAt: string;
  completedAt: string | null;
  court: Court | null;
}
interface MatchResultDraft { winner: string; team1: string; team2: string; }
interface OpenPlayAwardCandidate { memberId: string; name: string; participated: boolean; topFiveRank: number | null; participationRequestId: string | null; topFiveRequestId: string | null; }
interface OpenPlayAwardReview { activityDate: string; candidates: OpenPlayAwardCandidate[]; selectedAwardIds: string[]; awardedAwardIds: string[]; skipped: boolean; completed: boolean; completedAt: string | null; }
interface OpenPlaySession { id: string; active: boolean; startedAt: string; endedAt: string | null; awardReview: OpenPlayAwardReview | null; }
interface OpenPlayDraft { players: Player[]; courts: Court[]; matches: Match[]; queue: string[]; winnersQueue: string[]; bench: Record<string, BenchClock>; unavailable: string[]; playerLocks: string[][]; matchingMode: MatchingMode; forcedCategory: OpenPlayCategory | null; nextPlayerIds: string[] | null; session: OpenPlaySession | null; benchMigrationNeeded: boolean; revision: string | null; courtNameVersion: number; queueVersion: number; }
interface ImportRow {
  name: string;
  matches: OpenPlayMember[];
  selection: string;
  category: OpenPlayCategory;
  included: boolean;
}

const categories: OpenPlayCategory[] = ['Novice', 'Intermediate', 'High Intermediate'];
const draftKey = 'open-play-player-draft-v1';

@Component({
  selector: 'app-open-play-page',
  imports: [DatePipe, DecimalPipe, FormsModule, MemberProfileFrameComponent, NgTemplateOutlet, RouterLink],
  templateUrl: './open-play-page.component.html',
  styleUrl: './open-play-page.component.scss',
})
export class OpenPlayPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = getApiBaseUrl();
  private nextId = 0;
  private fileReadVersion = 0;
  protected readonly categories = categories;
  protected readonly members = signal<OpenPlayMember[]>([]);
  protected readonly matchingModeOptions = matchingModeOptions;
  protected readonly matchingMode = signal<MatchingMode>(defaultMatchingMode);
  protected readonly forcedCategory = signal<OpenPlayCategory | ''>('');
  protected readonly loadingMembers = signal(true);
  protected readonly memberError = signal('');
  protected readonly message = signal('');
  protected readonly storageError = signal('');
  protected readonly players = signal<Player[]>([]);
  protected readonly playerLocks = signal<string[][]>([]);
  protected readonly selectedLockPlayerIds = signal<string[]>([]);
  protected readonly queue = signal<string[]>([]);
  protected readonly winnersQueue = signal<string[]>([]);
  protected readonly bench = signal<Record<string, BenchClock>>({});
  protected readonly unavailable = signal<string[]>([]);
  protected readonly selectedSwapId = signal('');
  protected readonly draggingPlayerId = signal('');
  protected readonly matches = signal<Match[]>([]);
  protected readonly session = signal<OpenPlaySession | null>(null);
  protected readonly selectedAwardIds = signal<string[]>([]);
  protected readonly sessionBusy = signal(false);
  protected readonly awardBusy = signal(false);
  protected readonly sessionError = signal('');
  protected readonly awardError = signal('');
  protected readonly awardMessage = signal('');
  protected readonly archiveMessage = signal('');
  protected readonly now = signal(Date.now());
  protected readonly timeSinceGame = timeSinceGame;
  protected readonly formatBenchTime = formatBenchTime;
  protected readonly courts = signal<Court[]>([]);
  protected readonly newCourtName = signal('');
  protected readonly newCourtCategory = signal<OpenPlayCategory>('Novice');
  protected readonly selectedCourt = signal('');
  protected readonly courtError = signal('');
  protected readonly matchError = signal('');
  protected readonly resultError = signal('');
  protected readonly resultErrorMatchId = signal('');
  protected readonly manualMatchSlots = signal<string[] | null>(null);
  protected readonly resultDrafts = signal<Record<string, MatchResultDraft>>({});
  protected readonly editingMatch = signal('');
  protected readonly statuses: PlayerStatus[] = ['Not Arrived', 'Active', 'Rest', 'Left'];
  protected readonly search = signal('');
  protected readonly selectedMember = signal<OpenPlayMember | null>(null);
  protected readonly profileMember = signal<{ memberId: string; name: string } | null>(null);
  protected readonly memberCategory = signal<OpenPlayCategory | ''>('');
  protected readonly guestName = signal('');
  protected readonly guestCategory = signal<OpenPlayCategory | ''>('');
  protected readonly importCategory = signal<OpenPlayCategory | ''>('');
  protected readonly importRows = signal<ImportRow[]>([]);
  protected readonly importFileName = signal('');
  protected readonly filteredMembers = computed(() => {
    const query = this.normalize(this.search());
    if (!query) return [];
    return this.members().filter((member) =>
      [member.name, member.reClubId].some((value) => this.normalize(value ?? '').includes(query)),
    ).slice(0, 20);
  });
  protected readonly pendingImport = computed(() => this.importRows().some((row) => row.included && !row.selection));
  protected readonly ongoingMatches = computed(() => this.matches().filter((match) => match.status === 'ongoing'));
  protected readonly completedMatches = computed(() => this.matches().filter((match) => match.status === 'completed').slice().reverse());
  protected readonly availableCourts = computed(() => this.courts().filter((court) => !this.courtMatch(court.number)));
  protected readonly normalLine = computed(() => this.queue().map((id) => this.players().find((player) => player.id === id))
    .filter((player): player is Player => !!player && player.status === 'Active' && !this.isPlaying(player)));
  protected readonly winnersLine = computed(() => this.winnersQueue().map((id) => this.players().find((player) => player.id === id))
    .filter((player): player is Player => !!player && player.status === 'Active' && !this.isPlaying(player)));
  protected readonly lockedPlayerIds = computed(() => new Set(this.playerLocks().flat()));
  protected readonly eligiblePlayers = computed(() => [...this.normalLine(), ...this.winnersLine()].filter((player) => !this.unavailable().includes(player.id)));
  protected readonly matchingCandidates = computed(() => {
    const toCandidate = (player: Player, line: MatchingPlayer['line']): MatchingPlayer => {
      const { wins, losses } = this.playerRecord(player);
      return { id: player.id, category: player.category, line, waitMs: this.waitMs(player), wins, games: wins + losses };
    };
    return [...this.normalLine().filter((player) => !this.unavailable().includes(player.id)).map((player) => toCandidate(player, 'normal')),
      ...this.winnersLine().filter((player) => !this.unavailable().includes(player.id)).map((player) => toCandidate(player, 'winners'))];
  });
  protected readonly nextSuggestion = computed(() => suggestNextOpenPlayMatch(this.matchingCandidates(), this.matchingMode(), this.playerLocks(), this.forcedCategory() || null));
  protected readonly matchSlots = computed(() => {
    const eligible = new Set(this.eligiblePlayers().map((player) => player.id));
    const slots = this.manualMatchSlots() ?? this.nextSuggestion()?.teams.flat().map((player) => player.id) ?? ['', '', '', ''];
    return slots.map((id) => eligible.has(id) ? id : '');
  });
  protected readonly validMatchSlots = computed(() => {
    const ids = this.matchSlots();
    const selected = new Set(ids);
    return ids.every(Boolean) && selected.size === 4 && this.playerLocks().every((group) =>
      !group.some((id) => selected.has(id)) || group.every((id) => selected.has(id)),
    );
  });
  protected nextPlayerIdsForSave() {
    const eligible = new Set(this.eligiblePlayers().map((player) => player.id));
    return this.manualMatchSlots()?.map((id) => id && eligible.has(id) ? id : '') ?? null;
  }
  protected readonly matchLockConflict = computed(() => {
    const selected = new Set(this.matchSlots());
    return this.playerLocks().find((group) => group.some((id) => selected.has(id)) && !group.every((id) => selected.has(id))) ?? null;
  });
  protected readonly overdueNotSelected = computed(() => this.matchingCandidates().filter((player) =>
    player.waitMs >= 30 * 60000 && !this.matchSlots().includes(player.id),
  ).length);
  protected readonly selectedCourtDetails = computed(() => this.availableCourts().find((court) => String(court.number) === this.selectedCourt()));
  protected readonly topPlayers = computed(() => this.players().map((player) => {
    const record = this.playerRecord(player);
    const games = record.wins + record.losses;
    return { player, ...record, games, percent: games ? record.wins * 100 / games : 0 };
  }).filter((entry) => entry.games > 0)
    .sort((left, right) => right.percent - left.percent || right.wins - left.wins || right.games - left.games || left.player.name.localeCompare(right.player.name)).slice(0, 5));

  ngOnInit() {
    timer(60000, 60000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.now.set(Date.now()));
    this.restoreDraft();
    this.loadDraft();
    this.loadMembers();
  }

  confirmLeave() {
    return !this.isDirty() || window.confirm('Leave without saving the Open Play roster?');
  }

  protected canStartOpenPlay() {
    return this.draftReady() && !!this.revision && !this.sessionBusy() && !this.savingDraft() && !this.isDirty() &&
      !this.session()?.active && (!this.session()?.awardReview || !!this.session()?.awardReview?.completed);
  }

  protected canArchiveOpenPlay() {
    const session = this.session();
    return !!session && !session.active && !!session.awardReview?.completed && !this.isDirty() && !this.sessionBusy() && !this.savingDraft();
  }

  protected archiveOpenPlay() {
    const session = this.session();
    if (!session || !this.canArchiveOpenPlay() || !this.revision) return;
    if (!window.confirm('Archive this session, then clear its players and matches from Open Play?')) return;
    this.sessionBusy.set(true);
    this.sessionError.set('');
    this.archiveMessage.set('');
    this.http.post(`${this.apiUrl}/open-play/session/archive`, { sessionId: session.id, revision: this.revision }, { withCredentials: true }).subscribe({
      next: () => {
        this.sessionBusy.set(false);
        this.archiveMessage.set('Session archived. The live roster has been cleared.');
        this.loadDraft();
      },
      error: (error) => {
        this.sessionBusy.set(false);
        this.sessionError.set(error.error?.message ?? 'Unable to archive the Open Play session.');
      },
    });
  }

  protected updateMatchingMode(value: string) {
    if (!isMatchingMode(value)) return;
    this.matchingMode.set(value);
    this.manualMatchSlots.set(null);
    this.matchError.set('');
  }

  protected updateForcedCategory(value: string) {
    if (value !== '' && !categories.includes(value as OpenPlayCategory)) return;
    this.forcedCategory.set(value as OpenPlayCategory | '');
    this.manualMatchSlots.set(null);
    this.matchError.set('');
  }

  protected changeMatchingMode(value: string) {
    this.updateMatchingMode(value);
    this.publishNextPlayersState();
  }

  protected changeForcedCategory(value: string) {
    this.updateForcedCategory(value);
    this.publishNextPlayersState();
  }

  protected resetNextPlayers() {
    this.manualMatchSlots.set(null);
    this.publishNextPlayersState();
  }

  protected publishNextPlayersState() {
    if (!this.draftReady() || this.savingDraft()) return;
    this.http.put(`${this.apiUrl}/open-play/board-state`, {
      matchingMode: this.matchingMode(), forcedCategory: this.forcedCategory() || null,
      nextPlayerIds: this.nextPlayerIdsForSave(), playerLocks: this.playerLocks(), unavailable: this.unavailable(), revision: this.revision,
    }, { withCredentials: true }).subscribe({
      next: () => {
        if (this.matchError().includes('live board')) this.matchError.set('');
      },
      error: (error) => this.matchError.set(error.status === 409
        ? 'The saved roster changed. Reload before publishing Next Players.'
        : error.status === 400 && typeof error.error?.message === 'string'
          ? error.error.message
          : 'Unable to update the live board. Save the roster and try again.'),
    });
  }

  protected lockSelectedAndPublish() {
    this.lockSelectedPlayers();
    this.publishNextPlayersState();
  }

  protected unlockAndPublish(index: number) {
    this.unlockPlayers(index);
    this.publishNextPlayersState();
  }

  protected markUnavailableAndPublish(index: number) {
    this.markUnavailable(index);
    this.publishNextPlayersState();
  }

  protected markAvailableAndPublish(id: string) {
    this.markAvailable(id);
    this.publishNextPlayersState();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent) {
    if (this.isDirty()) event.preventDefault();
  }
  private revision: string | null = null;
  private readonly savedState = signal('{"players":[],"courts":[],"matches":[],"queue":[],"winnersQueue":[],"bench":{},"unavailable":[],"playerLocks":[],"matchingMode":"wait-priority","forcedCategory":null,"nextPlayerIds":null}');
  protected readonly benchMigrationNeeded = signal(false);
  protected readonly loadingDraft = signal(true);
  protected readonly draftReady = signal(false);
  protected readonly savingDraft = signal(false);
  protected readonly saveMessage = signal('');
  protected readonly legacyPlayers = signal<Player[]>([]);
  protected readonly isDirty = computed(() => this.benchMigrationNeeded() || JSON.stringify({ players: this.players(), courts: this.courts(), matches: this.matches(), queue: this.queue(), winnersQueue: this.winnersQueue(), bench: this.bench(), unavailable: this.unavailable(), playerLocks: this.playerLocks(), matchingMode: this.matchingMode(), forcedCategory: this.forcedCategory() || null, nextPlayerIds: this.nextPlayerIdsForSave() }) !== this.savedState());
  
  protected loadDraft() {
    if (this.draftReady() && this.isDirty() && !window.confirm('Discard unsaved changes and reload the saved roster?')) return;
    this.loadingDraft.set(true);
    this.storageError.set('');
    this.http.get<OpenPlayDraft>(`${this.apiUrl}/open-play/draft`, { withCredentials: true }).subscribe({
      next: (draft) => {
        if (!Array.isArray(draft.courts) || !Array.isArray(draft.matches) || !Array.isArray(draft.queue) || !Array.isArray(draft.winnersQueue) || !Array.isArray(draft.unavailable) || !Array.isArray(draft.playerLocks) || (draft.nextPlayerIds !== null && !Array.isArray(draft.nextPlayerIds)) || !draft.bench || draft.courtNameVersion !== 1 || draft.queueVersion !== 4) {
          this.draftReady.set(false);
          this.loadingDraft.set(false);
          this.storageError.set('The API does not support player availability, both lines, court names, player locks, and Next Players sharing. Update or restart the API before editing.');
          return;
        }
        const players = draft.players.map((player) => ({ ...player, status: player.status ?? 'Active' as const }));
        const matchingMode = isMatchingMode(draft.matchingMode) ? draft.matchingMode : defaultMatchingMode;
        const forcedCategory = categories.includes(draft.forcedCategory as OpenPlayCategory) ? draft.forcedCategory as OpenPlayCategory : '';
        const matches = draft.matches;
        const courts = draft.courts;
        const queue = draft.queue;
        const winnersQueue = draft.winnersQueue;
        const bench = draft.bench;
        const unavailable = draft.unavailable;
        const playerLocks = draft.playerLocks;
        this.players.set(players);
        this.matches.set(matches);
        this.session.set(draft.session ?? null);
        this.selectedAwardIds.set(draft.session?.awardReview?.selectedAwardIds ?? []);
        this.courts.set(courts);
        this.queue.set(queue);
        this.winnersQueue.set(winnersQueue);
        this.bench.set(bench);
        this.unavailable.set(unavailable);
        this.playerLocks.set(playerLocks);
        this.selectedLockPlayerIds.set([]);
        this.matchingMode.set(matchingMode);
        this.forcedCategory.set(forcedCategory);
        this.benchMigrationNeeded.set(draft.benchMigrationNeeded);
        this.savedState.set(JSON.stringify({ players, courts, matches, queue, winnersQueue, bench, unavailable, playerLocks, matchingMode, forcedCategory: forcedCategory || null, nextPlayerIds: draft.nextPlayerIds }));
        this.selectedCourt.set('');
        this.courtError.set('');
        this.manualMatchSlots.set(draft.nextPlayerIds);
        this.selectedSwapId.set('');
        this.resultDrafts.set({});
        this.editingMatch.set('');
        this.matchError.set('');
        this.resultError.set('');
        this.resultErrorMatchId.set('');
        this.revision = draft.revision;
        this.draftReady.set(true);
        this.loadingDraft.set(false);
        this.saveMessage.set('');
      },
      error: () => {
        this.loadingDraft.set(false);
        this.storageError.set('Unable to load the shared roster. Check the API and OpenPlay table, then retry.');
      },
    });
  }

  protected startOpenPlay() {
    if (!this.draftReady() || this.sessionBusy() || this.session()?.active) return;
    if (!this.revision) {
      this.sessionError.set('Save the roster before starting Open Play.');
      return;
    }
    if (this.isDirty()) {
      this.sessionError.set('Save roster changes before starting Open Play.');
      return;
    }
    this.sessionBusy.set(true);
    this.sessionError.set('');
    this.http.post(`${this.apiUrl}/open-play/session/start`, { revision: this.revision }, { withCredentials: true }).subscribe({
      next: () => { this.sessionBusy.set(false); this.loadDraft(); },
      error: (error) => {
        this.sessionBusy.set(false);
        this.sessionError.set(error.error?.message ?? 'Unable to start Open Play.');
      },
    });
  }

  protected endOpenPlay() {
    if (!this.draftReady() || this.sessionBusy() || !this.session()?.active) return;
    if (this.isDirty()) {
      this.sessionError.set('Save roster and match changes before ending Open Play.');
      return;
    }
    if (this.ongoingMatches().length) {
      this.sessionError.set('End or cancel every ongoing match before ending Open Play.');
      return;
    }
    this.sessionBusy.set(true);
    this.sessionError.set('');
    this.http.post(`${this.apiUrl}/open-play/session/end`, { revision: this.revision }, { withCredentials: true }).subscribe({
      next: () => { this.sessionBusy.set(false); this.loadDraft(); },
      error: (error) => {
        this.sessionBusy.set(false);
        this.sessionError.set(error.error?.message ?? 'Unable to end Open Play.');
      },
    });
  }

  protected participationAwardId(candidate: OpenPlayAwardCandidate) {
    return `${candidate.memberId}:participation`;
  }

  protected topFiveAwardId(candidate: OpenPlayAwardCandidate) {
    return `${candidate.memberId}:top-five`;
  }

  protected toggleAward(awardId: string, selected: boolean) {
    this.selectedAwardIds.update((ids) => selected
      ? ids.includes(awardId) ? ids : [...ids, awardId]
      : ids.filter((id) => id !== awardId));
  }

  protected isCandidateExcluded(candidate: OpenPlayAwardCandidate) {
    const ids = [candidate.participationRequestId ? this.participationAwardId(candidate) : '', candidate.topFiveRequestId ? this.topFiveAwardId(candidate) : ''].filter(Boolean);
    return ids.length > 0 && ids.every((id) => !this.selectedAwardIds().includes(id));
  }

  protected hasCandidateAwardBeenRecorded(candidate: OpenPlayAwardCandidate) {
    const ids = [candidate.participationRequestId ? this.participationAwardId(candidate) : '', candidate.topFiveRequestId ? this.topFiveAwardId(candidate) : ''].filter(Boolean);
    return ids.some((id) => this.session()?.awardReview?.awardedAwardIds.includes(id));
  }

  protected excludeCandidate(candidate: OpenPlayAwardCandidate, excluded: boolean) {
    const ids = [candidate.participationRequestId ? this.participationAwardId(candidate) : '', candidate.topFiveRequestId ? this.topFiveAwardId(candidate) : ''].filter(Boolean);
    this.selectedAwardIds.update((current) => excluded
      ? current.filter((id) => !ids.includes(id))
      : [...current, ...ids.filter((id) => !current.includes(id))]);
  }

  protected async awardSessionPoints() {
    const session = this.session();
    const review = session?.awardReview;
    if (!session || !review || review.completed || this.awardBusy() || !this.selectedAwardIds().length) return;
    this.awardBusy.set(true);
    this.awardError.set('');
    this.awardMessage.set('');
    try {
      const decision = await firstValueFrom(this.http.put<OpenPlayDraft>(`${this.apiUrl}/open-play/session/awards`, {
        sessionId: session.id, selectedAwardIds: this.selectedAwardIds(), skip: false,
      }, { withCredentials: true }));
      this.session.set(decision.session);
      this.revision = decision.revision;
      for (const awardId of decision.session?.awardReview?.selectedAwardIds ?? []) {
        const [memberId, kind] = awardId.split(':');
        const candidate = review.candidates.find((entry) => entry.memberId === memberId);
        const requestId = kind === 'participation' ? candidate?.participationRequestId : candidate?.topFiveRequestId;
        if (!candidate || !requestId) throw new Error('An award candidate is no longer available. Reload the award review.');
        const reason = kind === 'participation'
          ? `Open Play participation session ${session.id}`
          : `Open Play Top 5 session ${session.id} (rank ${candidate.topFiveRank})`;
        await firstValueFrom(this.http.post(`${this.apiUrl}/member-points/${encodeURIComponent(memberId)}`, {
          requestId, source: 'CustomAward', activityDate: review.activityDate, points: 1, reason,
        }, { withCredentials: true }));
        const progress = await firstValueFrom(this.http.put<OpenPlayDraft>(`${this.apiUrl}/open-play/session/awards/progress`, {
          sessionId: session.id, awardId,
        }, { withCredentials: true }));
        this.session.set(progress.session);
        this.revision = progress.revision;
      }
      const completed = await firstValueFrom(this.http.post<OpenPlayDraft>(`${this.apiUrl}/open-play/session/awards/complete`, {
        sessionId: session.id,
      }, { withCredentials: true }));
      this.session.set(completed.session);
      this.revision = completed.revision;
      this.selectedAwardIds.set(completed.session?.awardReview?.selectedAwardIds ?? []);
      this.awardMessage.set(`Awarded ${decision.session?.awardReview?.selectedAwardIds.length ?? 0} Open Play point${decision.session?.awardReview?.selectedAwardIds.length === 1 ? '' : 's'}.`);
    } catch (error) {
      this.awardError.set(error && typeof error === 'object' && 'error' in error && typeof error.error === 'object' && error.error && 'message' in error.error
        ? String(error.error.message) : error instanceof Error ? error.message : 'Unable to award Open Play points. You can retry safely.');
    } finally {
      this.awardBusy.set(false);
    }
  }

  protected async skipSessionAwards() {
    const session = this.session();
    if (!session?.awardReview || session.awardReview.completed || this.awardBusy()) return;
    this.awardBusy.set(true);
    this.awardError.set('');
    try {
      const completed = await firstValueFrom(this.http.put<OpenPlayDraft>(`${this.apiUrl}/open-play/session/awards`, {
        sessionId: session.id, selectedAwardIds: [], skip: true,
      }, { withCredentials: true }));
      this.session.set(completed.session);
      this.revision = completed.revision;
      this.selectedAwardIds.set([]);
      this.awardMessage.set('No points were awarded for this session.');
    } catch (error) {
      this.awardError.set(error instanceof Error ? error.message : 'Unable to close the award review.');
    } finally {
      this.awardBusy.set(false);
    }
  }
  
  protected saveDraft() {
    if (!this.draftReady() || this.savingDraft() || !this.isDirty()) return;
    this.savingDraft.set(true);
    this.storageError.set('');
    this.saveMessage.set('');
    this.http.put<OpenPlayDraft>(`${this.apiUrl}/open-play/draft`, {
      players: this.players(), courts: this.courts(), matches: this.matches(), queue: this.queue(), winnersQueue: this.winnersQueue(), bench: this.bench(), unavailable: this.unavailable(), playerLocks: this.playerLocks(), matchingMode: this.matchingMode(), forcedCategory: this.forcedCategory() || null, nextPlayerIds: this.nextPlayerIdsForSave(), revision: this.revision,
    }, { withCredentials: true }).subscribe({
      next: (draft) => {
        if (!Array.isArray(draft.matches) || !Array.isArray(draft.courts) || !Array.isArray(draft.queue) || !Array.isArray(draft.winnersQueue) || !Array.isArray(draft.unavailable) || !Array.isArray(draft.playerLocks) || (draft.nextPlayerIds !== null && !Array.isArray(draft.nextPlayerIds)) || !draft.bench || draft.courtNameVersion !== 1 || draft.queueVersion !== 4) {
          this.savingDraft.set(false);
          this.storageError.set('The API did not confirm player availability, both lines, match history, player locks, and Next Players sharing. Update or restart the API before saving again.');
          return;
        }
        this.players.set(draft.players);
        this.matches.set(draft.matches);
        this.session.set(draft.session ?? null);
        this.selectedAwardIds.set(draft.session?.awardReview?.selectedAwardIds ?? []);
        this.courts.set(draft.courts);
        this.queue.set(draft.queue);
        this.winnersQueue.set(draft.winnersQueue);
        this.bench.set(draft.bench);
        this.unavailable.set(draft.unavailable);
        this.playerLocks.set(draft.playerLocks);
        this.selectedLockPlayerIds.set([]);
        this.matchingMode.set(isMatchingMode(draft.matchingMode) ? draft.matchingMode : defaultMatchingMode);
        this.forcedCategory.set(categories.includes(draft.forcedCategory as OpenPlayCategory) ? draft.forcedCategory as OpenPlayCategory : '');
        this.manualMatchSlots.set(draft.nextPlayerIds);
        this.benchMigrationNeeded.set(false);
        this.savedState.set(JSON.stringify({ players: draft.players, courts: draft.courts, matches: draft.matches, queue: draft.queue, winnersQueue: draft.winnersQueue, bench: draft.bench, unavailable: draft.unavailable, playerLocks: draft.playerLocks, matchingMode: this.matchingMode(), forcedCategory: this.forcedCategory() || null, nextPlayerIds: draft.nextPlayerIds }));
        this.revision = draft.revision;
        this.savingDraft.set(false);
        this.saveMessage.set('Changes saved.');
      },
      error: (error) => {
        this.savingDraft.set(false);
        this.storageError.set(error.status === 409
          ? 'Another admin changed the roster. Your changes are not saved; reload the saved roster to continue.'
          : error.status === 400 && typeof error.error?.message === 'string'
            ? `${error.error.message} Your changes have not been saved.`
          : 'Unable to save the roster. Your changes have not been saved; try again.');
      },
    });
  }
  
  protected restoreLegacyDraft() {
    if (!this.draftReady() || this.players().length || !this.legacyPlayers().length) return;
    const players = this.legacyPlayers().map((player) => ({ ...player, status: player.status ?? 'Active' as const }));
    this.players.set(players);
    this.queue.set(players.filter((player) => player.status === 'Active').map((player) => player.id));
    this.winnersQueue.set([]);
    this.unavailable.set([]);
    this.bench.set(Object.fromEntries(players.map((player) => [player.id, {
      accumulatedMs: 0, since: player.status === 'Active' ? new Date().toISOString() : null,
    }])));
    this.saveMessage.set('Browser draft restored. Save the roster to share it.');
  }

  protected loadMembers() {
    this.loadingMembers.set(true);
    this.memberError.set('');
    this.http.get<OpenPlayMember[]>(`${this.apiUrl}/open-play/members`, { withCredentials: true }).pipe(
      timeout(20000),
      map((members) => {
        if (!Array.isArray(members)) throw new Error('Invalid member directory');
        return members;
      }),
    ).subscribe({
      next: (members) => {
        this.members.set(members.sort((left, right) => left.name.localeCompare(right.name)));
        this.loadingMembers.set(false);
      },
      error: () => {
        this.members.set([]);
        this.loadingMembers.set(false);
        this.memberError.set('Unable to load the member directory. Retry before searching or importing.');
      },
    });
  }

  protected selectMember(member: OpenPlayMember) {
    this.selectedMember.set(member);
    this.memberCategory.set(categoryFromSkills(member.skills) ?? '');
    this.search.set('');
    this.message.set('');
  }

  protected openMemberProfile(memberId: string, name: string) {
    this.profileMember.set({ memberId, name });
  }

  protected closeMemberProfile() {
    this.profileMember.set(null);
  }

  protected addMember() {
    const member = this.selectedMember();
    const category = this.memberCategory();
    if (!member || !category) return;
    if (this.players().some((player) => player.memberId === member.memberId)) {
      this.message.set('This member is already in the player list.');
      return;
    }
    this.addPlayers([{ name: member.name, memberId: member.memberId, category }]);
    this.selectedMember.set(null);
    this.memberCategory.set('');
  }

  protected addGuest() {
    const name = this.guestName().trim();
    const category = this.guestCategory();
    if (!name || !category) return;
    this.addPlayers([{ name, memberId: null, category }]);
    this.guestName.set('');
    this.guestCategory.set('');
  }

  protected async readFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.importCategory() || this.loadingMembers() || this.memberError()) return;
    const version = ++this.fileReadVersion;
    const category = this.importCategory() as OpenPlayCategory;
    this.importRows.set([]);
    this.importFileName.set(file.name);
    this.message.set('');
    try {
      const text = await file.text();
      if (version !== this.fileReadVersion) return;
      const names = parseParticipants(text);
      if (!names.length) {
        this.message.set('No numbered players were found under a Participants section.');
        return;
      }
      this.importRows.set(names.map((name) => {
        const matches = this.members().filter((member) =>
          !!member.reClubId?.trim() && this.normalize(member.reClubId) === this.normalize(name),
        );
        return { name, matches, selection: matches[0]?.memberId ?? 'guest', category, included: true };
      }));
    } catch {
      if (version === this.fileReadVersion) this.message.set('Unable to read this file. Choose a text file and try again.');
    }
  }

  protected updateImport(index: number, patch: Partial<ImportRow>) {
    this.importRows.update((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  protected addImport() {
    const rows = this.importRows().filter((row) => row.included);
    if (!rows.length || this.pendingImport()) return;
    const memberIds = rows.filter((row) => row.selection !== 'guest').map((row) => row.selection);
    if (new Set(memberIds).size !== memberIds.length || memberIds.some((id) => this.players().some((player) => player.memberId === id))) {
      this.message.set('A selected member appears more than once or is already in the player list.');
      return;
    }
    this.addPlayers(rows.map((row) => {
      const member = row.matches.find((match) => match.memberId === row.selection);
      return { name: member?.name ?? row.name, memberId: member?.memberId ?? null, category: row.category };
    }));
    this.importRows.set([]);
    this.importFileName.set('');
  }

  protected updateCategory(id: string, category: OpenPlayCategory) {
    if (!categories.includes(category)) return;
    this.players.update((players) => players.map((player) => player.id === id ? { ...player, category } : player));
  }

  protected updateStatus(id: string, status: PlayerStatus) {
    const player = this.players().find((entry) => entry.id === id);
    if (!player || !this.statuses.includes(status) || this.isPlaying(player) || player.status === status) return;
    const now = Date.now();
    this.now.set(now);
    this.bench.update((clocks) => ({ ...clocks, [id]: status === 'Active'
      ? resumeBench(clocks[id], now) : pauseBench(clocks[id], now) }));
    this.players.update((players) => players.map((player) => player.id === id ? { ...player, status } : player));
    this.queue.update((queue) => status === 'Active' ? [...queue.filter((entry) => entry !== id), id] : queue.filter((entry) => entry !== id));
    this.winnersQueue.update((queue) => queue.filter((entry) => entry !== id));
    this.unavailable.update((entries) => entries.filter((entry) => entry !== id));
    if (this.selectedSwapId() === id) this.selectedSwapId.set('');
  }

  protected isPlaying(player: Player) {
    return this.ongoingMatches().some((match) => match.teams.some((team) => team.some((participant) => this.samePlayer(player, participant))));
  }

  protected playerRecord(player: Player) {
    let wins = 0;
    let losses = 0;
    for (const match of this.completedMatches()) {
      const team = match.teams.findIndex((players) => players.some((participant) => this.samePlayer(player, participant)));
      if (team >= 0) {
        if (match.winner === team + 1) wins++;
        else if (match.winner !== null) losses++;
      }
    }
    return { wins, losses };
  }

  protected winPercentage(player: Player): number | null {
    const { wins, losses } = this.playerRecord(player);
    return wins + losses ? wins * 100 / (wins + losses) : null;
  }

  protected waitMs(player: Player): number {
    return benchMilliseconds(this.bench()[player.id] ?? { accumulatedMs: 0, since: null }, this.now());
  }

  protected waitIndicator(player: Player): 'warning' | 'above-average' | null {
    if (this.waitMs(player) >= 30 * 60000) return 'warning';
    const others = this.eligiblePlayers().filter((entry) => entry.id !== player.id);
    return others.length && this.waitMs(player) > others.reduce((sum, entry) => sum + this.waitMs(entry), 0) / others.length ? 'above-average' : null;
  }

  protected lastGameEndedAt(player: Player): string | null {
    return this.latestCompletedMatch(player)?.completedAt ?? null;
  }

  private latestCompletedMatch(player: Player): Match | null {
    let latest: Match | null = null;
    let latestTime = -Infinity;
    for (const match of this.matches()) {
      if (match.status !== 'completed') continue;
      const endedTime = match.completedAt ? Date.parse(match.completedAt) : NaN;
      if (Number.isFinite(endedTime) && endedTime >= latestTime &&
        match.teams.some((team) => team.some((participant) => this.samePlayer(player, participant)))) {
        latest = match;
        latestTime = endedTime;
      }
    }
    return latest;
  }

  protected updateMatchSlot(index: number, id: string) {
    if (id && !this.eligiblePlayers().some((player) => player.id === id)) return;
    this.matchError.set('');
    const slots = [...this.matchSlots()];
    const previousIndex = id ? slots.indexOf(id) : -1;
    if (previousIndex >= 0 && previousIndex !== index) slots[previousIndex] = slots[index];
    slots[index] = id;
    this.manualMatchSlots.set(slots);
  }

  protected toggleLockPlayer(id: string, selected: boolean) {
    if (!this.players().some((player) => player.id === id) || this.lockedPlayerIds().has(id)) return;
    this.selectedLockPlayerIds.update((ids) => {
      if (!selected) return ids.filter((entry) => entry !== id);
      return ids.includes(id) || ids.length >= 4 ? ids : [...ids, id];
    });
  }

  protected lockSelectedPlayers() {
    const ids = this.selectedLockPlayerIds();
    if (ids.length < 2 || ids.length > 4 || ids.some((id) => this.lockedPlayerIds().has(id))) return;
    this.playerLocks.update((groups) => [...groups, [...ids]]);
    this.selectedLockPlayerIds.set([]);
    this.manualMatchSlots.set(null);
  }

  protected unlockPlayers(index: number) {
    this.playerLocks.update((groups) => groups.filter((_, groupIndex) => groupIndex !== index));
    this.manualMatchSlots.set(null);
  }

  protected playerLockFor(id: string) {
    return this.playerLocks().find((group) => group.includes(id));
  }

  protected playerMembershipType(player: Player): 'non-member' | 'member' | 'gold-member' {
    if (!player.memberId) return 'non-member';
    const expiresOn = this.members().find((member) => member.memberId === player.memberId)?.goldMembershipExpiresOn;
    return isGoldMembershipActive(expiresOn) ? 'gold-member' : 'member';
  }

  protected playerLockNames(ids: string[], excludeId = '') {
    return ids.filter((id) => id !== excludeId)
      .map((id) => this.players().find((player) => player.id === id)?.name ?? id)
      .join(', ');
  }

  protected slotPlayer(id: string) {
    return this.eligiblePlayers().find((player) => player.id === id);
  }

  protected selectSwapPlayer(id: string) {
    if (!this.eligiblePlayers().some((player) => player.id === id)) return;
    this.selectedSwapId.update((current) => current === id ? '' : id);
  }

  protected applySelectedPlayer(index: number) {
    if (!this.selectedSwapId()) return;
    this.updateMatchSlot(index, this.selectedSwapId());
    this.selectedSwapId.set('');
    this.publishNextPlayersState();
  }

  protected dragPlayer(event: DragEvent, id: string) {
    if (!this.eligiblePlayers().some((player) => player.id === id) || !event.dataTransfer) { event.preventDefault(); return; }
    this.draggingPlayerId.set(id);
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  protected dropPlayer(event: DragEvent, index: number) {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') ?? '';
    if (id && id === this.draggingPlayerId()) this.updateMatchSlot(index, id);
    this.draggingPlayerId.set('');
    this.selectedSwapId.set('');
    this.publishNextPlayersState();
  }

  protected markUnavailable(index: number) {
    const slots = [...this.matchSlots()];
    const id = slots[index];
    const removed = this.matchingCandidates().find((player) => player.id === id);
    if (!removed) return;
    const lockedGroup = this.playerLockFor(id);
    this.unavailable.update((entries) => [...entries, id]);
    const moveFront = (line: string[]) => line.includes(id) ? [id, ...line.filter((entry) => entry !== id)] : line;
    this.queue.update(moveFront);
    this.winnersQueue.update(moveFront);
    if (this.selectedSwapId() === id) this.selectedSwapId.set('');
    if (lockedGroup) {
      this.manualMatchSlots.set(null);
      this.matchError.set('');
      return;
    }
    const fixed = slots.filter((entry, slotIndex) => slotIndex !== index && entry);
    const candidates = this.matchingCandidates();
    const average = candidates.length ? candidates.reduce((sum, player) => sum + player.waitMs, 0) / candidates.length : 0;
    const urgency = (player: MatchingPlayer) => player.waitMs >= 30 * 60000 ? 3 : player.waitMs >= 25 * 60000 ? 2 : player.waitMs > average ? 1 : 0;
    const replacements = candidates.filter((player) => !fixed.includes(player.id)).sort((left, right) =>
      Number(right.category === removed.category) - Number(left.category === removed.category) ||
      Number(right.line === removed.line) - Number(left.line === removed.line) ||
      urgency(right) - urgency(left) || (urgency(left) ? right.waitMs - left.waitMs : 0),
    );
    const replacement = replacements.find((candidate) => {
      const group = [...candidates.filter((player) => fixed.includes(player.id)), candidate];
      if (group.length < 4) return true;
      const category = this.categories[Math.max(...group.map((player) => this.categories.indexOf(player.category)))];
      return !!suggestOpenPlayMatch(group, category);
    });
    slots[index] = replacement?.id ?? '';
    this.manualMatchSlots.set(slots);
    this.matchError.set(replacement ? '' : 'No suitable replacement is available.');
  }

  protected markAvailable(id: string) {
    this.unavailable.update((entries) => entries.filter((entry) => entry !== id));
    this.matchError.set('');
  }

  protected updateSelectedCourt(value: string) {
    this.selectedCourt.set(value);
    this.matchError.set('');
  }

  protected courtMatch(number: number) {
    return this.ongoingMatches().find((match) => match.court?.number === number);
  }

  protected addCourt() {
    const number = Array.from({ length: 32 }, (_, index) => index + 1).find((candidate) => !this.courts().some((court) => court.number === candidate));
    if (!number) {
      this.courtError.set('The current roster has reached the 32-court limit.');
      return;
    }
    const name = this.newCourtName().trim() || `Court ${number}`;
    if (name.length > 100) {
      this.courtError.set('Court names must be at most 100 characters.');
      return;
    }
    this.courts.update((courts) => [...courts, { number, name, category: this.newCourtCategory() }].sort((left, right) => left.number - right.number));
    this.newCourtName.set('');
    if (!this.selectedCourt()) this.selectedCourt.set(String(number));
    this.courtError.set('');
  }

  protected updateCourt(number: number, category: OpenPlayCategory) {
    if (!this.categories.includes(category) || this.courtMatch(number)) return;
    this.courts.update((courts) => courts.map((court) => court.number === number ? { ...court, category } : court));
  }

  protected removeCourt(number: number) {
    if (this.courtMatch(number)) return;
    this.courts.update((courts) => courts.filter((court) => court.number !== number));
    if (this.selectedCourt() === String(number)) this.selectedCourt.set('');
  }

  protected assignMatchCourt(match: Match, value: string) {
    if (match.status !== 'ongoing' || match.court) return;
    const court = this.availableCourts().find((entry) => entry.number === Number(value));
    if (!court) {
      this.resultErrorMatchId.set(match.id);
      this.resultError.set('Choose an available court.');
      return;
    }
    this.matches.update((matches) => matches.map((entry) => entry.id === match.id ? { ...entry, court: { ...court } } : entry));
    if (this.selectedCourt() === String(court.number)) this.selectedCourt.set('');
    this.resultError.set('');
    this.resultErrorMatchId.set('');
  }

  protected startMatch() {
    if (this.matches().length >= 250) {
      this.matchError.set('The current roster has reached the 250-match limit.');
      return;
    }
    const court = this.availableCourts().find((entry) => entry.number === Number(this.selectedCourt()));
    if (!court) {
      this.matchError.set('Choose an available court.');
      return;
    }
    const ids = this.matchSlots();
    if (this.matchLockConflict()) {
      this.matchError.set('Locked players must be selected together.');
      return;
    }
    const selected = ids.map((id) => this.eligiblePlayers().find((player) => player.id === id));
    if (new Set(ids).size !== 4 || selected.some((player) => !player)) {
      this.matchError.set('Choose four different active players who are not already playing.');
      return;
    }
    const participants = (selected as Player[]).map(({ id, name, memberId }) => ({ id, name, memberId }));
    const now = Date.now();
    this.now.set(now);
    this.bench.update((clocks) => ({ ...clocks, ...Object.fromEntries(ids.map((id) => [id, pauseBench(clocks[id], now)])) }));
    this.matches.update((matches) => [...matches, {
      id: `${Date.now()}-${this.nextId++}`, teams: [participants.slice(0, 2), participants.slice(2, 4)],
      status: 'ongoing', winner: null, score: null, startedAt: new Date(now).toISOString(), completedAt: null, court: { ...court },
    }]);
    this.manualMatchSlots.set(null);
    this.selectedSwapId.set('');
    this.draggingPlayerId.set('');
    this.selectedCourt.set('');
    this.matchError.set('');
  }

  protected resultDraft(match: Match): MatchResultDraft {
    return this.resultDrafts()[match.id] ?? {
      winner: match.winner ? String(match.winner) : '',
      team1: match.score ? String(match.score.team1) : '',
      team2: match.score ? String(match.score.team2) : '',
    };
  }

  protected updateResult(match: Match, patch: Partial<MatchResultDraft>) {
    this.resultDrafts.update((drafts) => ({ ...drafts, [match.id]: { ...this.resultDraft(match), ...patch } }));
  }

  protected saveResult(match: Match) {
    const draft = this.resultDraft(match);
    this.resultErrorMatchId.set(match.id);
    const winner = draft.winner === '' ? null : Number(draft.winner);
    if (winner !== null && winner !== 1 && winner !== 2) {
      this.resultError.set('Select a valid winning team.');
      return;
    }
    let score: Match['score'] = null;
    if (draft.team1 !== '' || draft.team2 !== '') {
      if (winner === null) {
        this.resultError.set('Select a winner to save scores, or clear both scores to end without a result.');
        return;
      }
      if (!/^\d{1,3}$/.test(draft.team1) || !/^\d{1,3}$/.test(draft.team2)) {
        this.resultError.set('Enter both scores as whole numbers from 0 to 999, or leave both blank.');
        return;
      }
      const team1 = Number(draft.team1);
      const team2 = Number(draft.team2);
      if (team1 === team2 || (team1 > team2 ? 1 : 2) !== winner) {
        this.resultError.set('Scores must be different and match the winning team.');
        return;
      }
      score = { team1, team2 };
    }
    const completedAt = match.completedAt ?? new Date().toISOString();
    if (match.status === 'ongoing' || match.winner !== winner) {
      const returning = match.teams.map((team) => team.map((participant) => this.players().find((player) => this.samePlayer(player, participant)))
        .filter((player): player is Player => !!player && (player.status === 'Active' || (match.status === 'ongoing' && player.status === 'Not Arrived')) &&
          (match.status === 'ongoing' || this.latestCompletedMatch(player)?.id === match.id)));
      const returningIds = returning.flat().map((player) => player.id);
      const winningIds = winner === null ? [] : returning[winner - 1].map((player) => player.id);
      const otherIds = winner === null ? returningIds : returning[winner === 1 ? 1 : 0].map((player) => player.id);
      if (match.status === 'ongoing') {
        const now = Date.parse(completedAt);
        const participants = this.players().filter((player) => match.teams.some((team) => team.some((entry) => this.samePlayer(player, entry))));
        this.now.set(now);
        this.bench.update((clocks) => ({ ...clocks, ...Object.fromEntries(participants.map((player) => [player.id, {
          accumulatedMs: 0, since: returningIds.includes(player.id) ? completedAt : null,
        }])) }));
      }
      this.players.update((players) => players.map((player) => returningIds.includes(player.id) ? { ...player, status: 'Active' } : player));
      this.queue.update((queue) => [...queue.filter((id) => !returningIds.includes(id)), ...otherIds]);
      this.winnersQueue.update((queue) => [...queue.filter((id) => !returningIds.includes(id)), ...winningIds]);
    }
    this.matches.update((matches) => matches.map((entry) => entry.id === match.id ? {
      ...entry, status: 'completed', winner, score, completedAt: entry.completedAt ?? completedAt,
    } : entry));
    this.editingMatch.set('');
    this.resultDrafts.update((drafts) => { const updated = { ...drafts }; delete updated[match.id]; return updated; });
    this.resultError.set('');
    this.resultErrorMatchId.set('');
  }

  protected cancelMatch(id: string) {
    if (!window.confirm('Cancel this ongoing match?')) return;
    const match = this.ongoingMatches().find((entry) => entry.id === id);
    if (match) {
      const now = Date.now();
      const returning = this.players().filter((player) => player.status === 'Active' && match.teams.some((team) => team.some((entry) => this.samePlayer(player, entry))));
      this.now.set(now);
      this.bench.update((clocks) => ({ ...clocks, ...Object.fromEntries(returning.map((player) => [player.id, resumeBench(clocks[player.id], now)])) }));
    }
    this.matches.update((matches) => matches.filter((match) => match.id !== id || match.status !== 'ongoing'));
    this.cancelResultEdit(id);
  }

  protected cancelResultEdit(id: string) {
    this.resultDrafts.update((drafts) => { const updated = { ...drafts }; delete updated[id]; return updated; });
    this.editingMatch.set('');
    this.resultError.set('');
    this.resultErrorMatchId.set('');
  }

  private samePlayer(player: MatchPlayer, participant: MatchPlayer) {
    return player.id === participant.id || (!!player.memberId && player.memberId === participant.memberId);
  }

  protected removePlayer(id: string) {
    this.players.update((players) => players.filter((player) => player.id !== id));
    this.queue.update((queue) => queue.filter((entry) => entry !== id));
    this.winnersQueue.update((queue) => queue.filter((entry) => entry !== id));
    this.unavailable.update((entries) => entries.filter((entry) => entry !== id));
    this.playerLocks.update((groups) => groups.map((group) => group.filter((entry) => entry !== id)).filter((group) => group.length >= 2));
    this.selectedLockPlayerIds.update((ids) => ids.filter((entry) => entry !== id));
    if (this.selectedSwapId() === id) this.selectedSwapId.set('');
    this.bench.update((clocks) => { const updated = { ...clocks }; delete updated[id]; return updated; });
  }

  private addPlayers(players: Omit<Player, 'id' | 'status'>[]) {
    const added = players.map((player) => ({
      ...player, id: `${Date.now()}-${this.nextId++}`, status: 'Not Arrived' as const,
    }));
    this.players.update((current) => [...current, ...added]);
    this.bench.update((clocks) => ({ ...clocks, ...Object.fromEntries(added.map((player) => [player.id, { accumulatedMs: 0, since: null }])) }));
    this.message.set('');
  }

  private normalize(value: string) {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  private restoreDraft() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(draftKey) ?? '[]');
      if (!Array.isArray(saved) || !saved.every((player) =>
        player && typeof player.id === 'string' && typeof player.name === 'string' &&
        categories.includes(player.category) && (player.memberId === null || typeof player.memberId === 'string'),
      )) throw new Error('Invalid draft');
      this.legacyPlayers.set(saved as Player[]);
    } catch {
      this.storageError.set('The previous browser draft could not be read.');
    }
  }
}