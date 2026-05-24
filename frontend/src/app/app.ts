import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';

interface Player {
  id: number;
  name: string;
  dupr: number | null;
  gender?: string | null;
  skillLevel: 'Beginner' | 'Novice' | 'Intermediate' | 'High Intermediate' | 'Advanced';
  isReady: boolean;
  checkedInAt: string | null;
  isPlaying: boolean;
  recentGamesPlayed: number;
}

interface Team {
  name: string;
  players: Player[];
}

interface GameScore {
  team1: number;
  team2: number;
}

interface ScoreDraft {
  team1: string;
  team2: string;
}

type QueueSelectionMode = 'check-in-order' | 'queue-line' | 'least-played-first';
type TeamMatchingMode = 'sequential' | 'dupr-balance' | 'skill-balance';

interface CourtAssignment {
  courtNumber: number;
  players: Player[];
  teams: Team[];
}

interface GameAssignmentRequest {
  courtNumber: number;
  playerIds: number[];
}

interface SwapSelection {
  playerId: number;
}

interface Game {
  id: number;
  courtNumber: number;
  status: 'ongoing' | 'completed';
  createdAt: string;
  completedAt: string | null;
  score: GameScore | null;
  players: Player[];
  teams: Team[];
}

interface Round {
  id: number;
  roundNumber: number;
  status: 'ongoing' | 'completed';
  createdAt: string;
  completedAt: string | null;
  games: Game[];
}

interface QueueSnapshot {
  players: Player[];
  ongoingRounds: Round[];
  recentRounds: Round[];
  nextGame: {
    courtCount: number;
    selectionMode: QueueSelectionMode;
    matchingMode?: TeamMatchingMode;
    eligiblePlayers: Player[];
    selectedPlayers: Player[];
    courts: CourtAssignment[];
  };
}

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = 'http://localhost:3000';
  private readonly rosterScrollPanel = viewChild<ElementRef<HTMLDivElement>>('rosterScrollPanel');
  private preservedRosterScrollTop: number | null = null;

  protected readonly snapshot = signal<QueueSnapshot | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isMutating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly courtCount = signal(1);
  protected readonly selectionMode = signal<QueueSelectionMode>('queue-line');
  protected readonly matchingMode = signal<TeamMatchingMode>('dupr-balance');
  protected readonly previewCourts = signal<CourtAssignment[]>([]);
  protected readonly playerSearch = signal('');
  protected readonly scoreDrafts = signal<Record<number, ScoreDraft>>({});
  protected readonly eligiblePlayerOrder = signal<Player[]>([]);
  protected readonly swapSelection = signal<SwapSelection | null>(null);
  protected readonly filteredPlayers = computed(() => {
    const searchTerm = this.playerSearch().trim().toLowerCase();
    const players = this.snapshot()?.players ?? [];

    if (!searchTerm) {
      return players;
    }

    return players.filter((player) => {
      const statusLabel = player.isPlaying
        ? 'in game'
        : player.isReady
          ? 'ready'
          : 'not ready';
      const duprLabel = player.dupr === null ? 'nr' : player.dupr.toFixed(2);
      const genderLabel = player.gender ?? '';
      const searchableText = `${player.name} ${player.skillLevel} ${genderLabel} ${statusLabel} ${duprLabel}`.toLowerCase();

      return searchableText.includes(searchTerm);
    });
  });
  protected readonly displayedOngoingRounds = computed(() =>
    (this.snapshot()?.ongoingRounds ?? [])
      .map((round) => ({
        ...round,
        games: round.games.filter((game) => game.status === 'ongoing'),
      }))
      .filter((round) => round.games.length > 0),
  );
  protected readonly displayedRecentRounds = computed(() =>
    [...(this.snapshot()?.ongoingRounds ?? []), ...(this.snapshot()?.recentRounds ?? [])]
      .map((round) => ({
        ...round,
        games: round.games.filter((game) => game.status === 'completed'),
      }))
      .filter((round) => round.games.length > 0)
      .sort((left, right) => {
        const leftCompletedAt = this.getLatestCompletedAt(left);
        const rightCompletedAt = this.getLatestCompletedAt(right);

        return rightCompletedAt.localeCompare(leftCompletedAt);
      }),
  );
  protected readonly readyCount = computed(
    () => this.snapshot()?.players.filter((player) => player.isReady).length ?? 0,
  );
  protected readonly availableCount = computed(
    () =>
      this.snapshot()?.players.filter((player) => player.isReady && !player.isPlaying).length ?? 0,
  );
  protected readonly requiredPlayers = computed(() => this.courtCount() * 4);
  protected readonly selectedPreviewPlayers = computed(() =>
    this.selectedPreviewCourts().flatMap((court) => court.teams.flatMap((team) => team.players)),
  );
  protected readonly selectedPreviewCourts = computed(() => this.previewCourts());

  ngOnInit() {
    this.loadSnapshot();
  }

  protected toggleReady(player: Player) {
    this.preserveRosterScrollPosition();

    this.runMutation(
      this.http.patch<Player>(`${this.apiBaseUrl}/players/${player.id}/ready`, {
        isReady: !player.isReady,
      }),
    );
  }

  protected startNextGame() {
    const gameAssignments: GameAssignmentRequest[] = this.selectedPreviewCourts().map((court) => ({
      courtNumber: court.courtNumber,
      playerIds: court.players.map((player) => player.id),
    }),
    );

    if (gameAssignments.length !== this.courtCount()) {
      return;
    }

    this.runMutation(this.http.post<Game[]>(`${this.apiBaseUrl}/games/batch`, { gameAssignments }));
  }

  protected setPreviewCourtNumber(courtNumber: number, value: string) {
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 10) {
      return;
    }

    this.previewCourts.update((courts) => {
      const currentIndex = courts.findIndex((court) => court.courtNumber === courtNumber);
      const targetIndex = courts.findIndex((court) => court.courtNumber === parsedValue);

      if (currentIndex === -1 || currentIndex === targetIndex) {
        return courts;
      }

      const nextCourts = [...courts];

      if (targetIndex !== -1) {
        nextCourts[targetIndex] = {
          ...nextCourts[targetIndex],
          courtNumber,
        };
      }

      nextCourts[currentIndex] = {
        ...nextCourts[currentIndex],
        courtNumber: parsedValue,
      };

      return nextCourts;
    });
  }

  protected updateScoreDraft(gameId: number, teamKey: keyof ScoreDraft, value: string) {
    const sanitizedValue = value.replace(/[^0-9]/g, '');

    this.scoreDrafts.update((drafts) => ({
      ...drafts,
      [gameId]: {
        team1: drafts[gameId]?.team1 ?? '',
        team2: drafts[gameId]?.team2 ?? '',
        [teamKey]: sanitizedValue,
      },
    }));
  }

  protected canCompleteGame(gameId: number) {
    const draft = this.scoreDrafts()[gameId];

    return !!draft?.team1 && !!draft?.team2;
  }

  protected completeGame(gameId: number) {
    const draft = this.scoreDrafts()[gameId];

    if (!draft?.team1 || !draft?.team2) {
      this.errorMessage.set('Enter both team scores before completing the match.');
      return;
    }

    this.runMutation(
      this.http.patch<Round>(`${this.apiBaseUrl}/games/${gameId}/complete`, {
        team1: Number(draft.team1),
        team2: Number(draft.team2),
      }),
      () => {
        this.scoreDrafts.update((drafts) => {
          const nextDrafts = { ...drafts };
          delete nextDrafts[gameId];
          return nextDrafts;
        });
      },
    );
  }

  protected refresh() {
    this.loadSnapshot();
  }

  protected setCourtCount(value: string) {
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      return;
    }

    this.courtCount.set(parsedValue);
    this.loadSnapshot();
  }

  protected setSelectionMode(value: string) {
    if (
      value !== 'queue-line'
      && value !== 'check-in-order'
      && value !== 'least-played-first'
    ) {
      return;
    }

    this.selectionMode.set(value);
    this.loadSnapshot();
  }

  protected setMatchingMode(value: string) {
    if (value !== 'dupr-balance' && value !== 'sequential' && value !== 'skill-balance') {
      return;
    }

    this.matchingMode.set(value);
    this.loadSnapshot();
  }

  protected updatePlayerSearch(value: string) {
    this.playerSearch.set(value);
  }

  protected clearPlayerSearch() {
    this.playerSearch.set('');
  }

  protected pickSwapPlayer(playerId: number) {
    const currentSelection = this.swapSelection();

    if (!currentSelection) {
      this.swapSelection.set({ playerId });
      return;
    }

    if (currentSelection.playerId === playerId) {
      this.swapSelection.set(null);
      return;
    }

    let nextEligiblePlayers: Player[] | null = null;

    this.eligiblePlayerOrder.update((players) => {
      const firstIndex = players.findIndex((player) => player.id === currentSelection.playerId);
      const secondIndex = players.findIndex((player) => player.id === playerId);

      if (firstIndex === -1 || secondIndex === -1) {
        nextEligiblePlayers = players;
        return players;
      }

      nextEligiblePlayers = [...players];
      [nextEligiblePlayers[firstIndex], nextEligiblePlayers[secondIndex]] = [
        nextEligiblePlayers[secondIndex],
        nextEligiblePlayers[firstIndex],
      ];

      return nextEligiblePlayers;
    });

    if (nextEligiblePlayers) {
      this.previewCourts.update((courts) =>
        applyPreviewSwap(courts, nextEligiblePlayers!, currentSelection.playerId, playerId),
      );
    }

    this.swapSelection.set(null);
  }

  protected clearSwapSelection() {
    this.swapSelection.set(null);
  }

  protected isSwapSelected(playerId: number) {
    return this.swapSelection()?.playerId === playerId;
  }

  protected isInSuggestedPlayers(playerId: number) {
    return this.selectedPreviewPlayers().some((player) => player.id === playerId);
  }

  protected formatDuration(startedAt: string, completedAt: string | null) {
    if (!completedAt) {
      return '--:--';
    }

    const durationMilliseconds = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
      return '--:--';
    }

    const totalSeconds = Math.floor(durationMilliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  protected getSelectionModeLabel(selectionMode: QueueSelectionMode) {
    if (selectionMode === 'queue-line') {
      return 'Queue line';
    }

    if (selectionMode === 'check-in-order') {
      return 'Check-in order';
    }

    return 'Least played first';
  }

  protected getMatchingModeLabel(matchingMode: TeamMatchingMode) {
    if (matchingMode === 'sequential') {
      return 'Sequential teams';
    }

    if (matchingMode === 'skill-balance') {
      return 'Skill balanced';
    }

    return 'DUPR balanced';
  }

  private loadSnapshot() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http
      .get<QueueSnapshot>(`${this.apiBaseUrl}/queue`, {
        params: {
          courtCount: this.courtCount(),
          selectionMode: this.selectionMode(),
          matchingMode: this.matchingMode(),
        },
      })
      .subscribe({
      next: (snapshot) => {
        const matchingMode = snapshot.nextGame.matchingMode ?? this.matchingMode();
        const normalizedCourts = assignSequentialCourtNumbers(snapshot.nextGame.courts);
        const normalizedSnapshot: QueueSnapshot = {
          ...snapshot,
          nextGame: {
            ...snapshot.nextGame,
            matchingMode,
            courts: normalizedCourts,
          },
        };

        this.snapshot.set(normalizedSnapshot);
        this.matchingMode.set(matchingMode);
        this.previewCourts.set(normalizedSnapshot.nextGame.courts);
        this.eligiblePlayerOrder.set(normalizedSnapshot.nextGame.eligiblePlayers);
        this.swapSelection.set(null);
        this.primeScoreDrafts(
          normalizedSnapshot.ongoingRounds.flatMap((round) =>
            round.games.filter((game) => game.status === 'ongoing'),
          ),
        );
        this.isLoading.set(false);
        this.restoreRosterScrollPosition();
      },
      error: () => {
        this.errorMessage.set(
          'The API is unavailable. Start the Nest server on port 3000 to load live queue data.',
        );
        this.isLoading.set(false);
        this.preservedRosterScrollTop = null;
      },
      });
  }

  private runMutation(request: { subscribe: Function }, onSuccess?: () => void) {
    this.isMutating.set(true);
    this.errorMessage.set('');

    request.subscribe({
      next: () => {
        onSuccess?.();
        this.isMutating.set(false);
        this.loadSnapshot();
      },
      error: () => {
        this.errorMessage.set('The change could not be saved.');
        this.isMutating.set(false);
      },
    });
  }

  private primeScoreDrafts(games: Game[]) {
    this.scoreDrafts.update((drafts) => {
      const nextDrafts = { ...drafts };

      for (const game of games) {
        if (!nextDrafts[game.id]) {
          nextDrafts[game.id] = { team1: '', team2: '' };
        }
      }

      for (const gameId of Object.keys(nextDrafts)) {
        const exists = games.some((game) => game.id === Number(gameId));

        if (!exists) {
          delete nextDrafts[Number(gameId)];
        }
      }

      return nextDrafts;
    });
  }

  private preserveRosterScrollPosition() {
    this.preservedRosterScrollTop = this.rosterScrollPanel()?.nativeElement.scrollTop ?? null;
  }

  private restoreRosterScrollPosition() {
    if (this.preservedRosterScrollTop === null) {
      return;
    }

    const scrollTop = this.preservedRosterScrollTop;
    this.preservedRosterScrollTop = null;

    setTimeout(() => {
      const panel = this.rosterScrollPanel()?.nativeElement;

      if (panel) {
        panel.scrollTop = scrollTop;
      }
    });
  }

  private getLatestCompletedAt(round: Round) {
    return round.games.reduce((latestCompletedAt, game) => {
      if (!game.completedAt) {
        return latestCompletedAt;
      }

      return game.completedAt > latestCompletedAt ? game.completedAt : latestCompletedAt;
    }, round.completedAt ?? '');
  }
}

function assignSequentialCourtNumbers(courts: CourtAssignment[]) {
  return courts.map((court, index) => ({
    ...court,
    courtNumber: index + 1,
  }));
}

function buildCourts(players: Player[], matchingMode: TeamMatchingMode): CourtAssignment[] {
  const courts: CourtAssignment[] = [];

  for (let index = 0; index < players.length; index += 4) {
    const courtPlayers = players.slice(index, index + 4);

    if (courtPlayers.length < 4) {
      break;
    }

    courts.push({
      courtNumber: courts.length + 1,
      players: courtPlayers,
      teams: buildTeams(courtPlayers, matchingMode),
    });
  }

  return courts;
}

function buildTeams(players: Player[], matchingMode: TeamMatchingMode): Team[] {
  if (players.length !== 4) {
    return [];
  }

  if (matchingMode === 'sequential') {
    return [
      {
        name: 'Team 1',
        players: players.slice(0, 2),
      },
      {
        name: 'Team 2',
        players: players.slice(2, 4),
      },
    ];
  }

  if (matchingMode === 'skill-balance') {
    const pairings: Team[][] = [
      [
        { name: 'Team 1', players: [players[0], players[1]] },
        { name: 'Team 2', players: [players[2], players[3]] },
      ],
      [
        { name: 'Team 1', players: [players[0], players[2]] },
        { name: 'Team 2', players: [players[1], players[3]] },
      ],
      [
        { name: 'Team 1', players: [players[0], players[3]] },
        { name: 'Team 2', players: [players[1], players[2]] },
      ],
    ];

    return pairings.reduce((bestPairing, currentPairing) => {
      if (!bestPairing) {
        return currentPairing;
      }

      return compareSkillBalancedPairings(currentPairing, bestPairing) < 0 ? currentPairing : bestPairing;
    }, null as Team[] | null) ?? [];
  }

  const pairings: Team[][] = [
    [
      { name: 'Team 1', players: [players[0], players[1]] },
      { name: 'Team 2', players: [players[2], players[3]] },
    ],
    [
      { name: 'Team 1', players: [players[0], players[2]] },
      { name: 'Team 2', players: [players[1], players[3]] },
    ],
    [
      { name: 'Team 1', players: [players[0], players[3]] },
      { name: 'Team 2', players: [players[1], players[2]] },
    ],
  ];

  return pairings.reduce((bestPairing, currentPairing) => {
    if (!bestPairing) {
      return currentPairing;
    }

    return compareTeamPairings(currentPairing, bestPairing) < 0 ? currentPairing : bestPairing;
  }, null as Team[] | null) ?? [];
}

function compareTeamPairings(left: Team[], right: Team[]) {
  const differenceComparison = getTeamRatingDifference(left) - getTeamRatingDifference(right);

  if (differenceComparison !== 0) {
    return differenceComparison;
  }

  const strongerTeamComparison = getStrongestTeamRating(left) - getStrongestTeamRating(right);

  if (strongerTeamComparison !== 0) {
    return strongerTeamComparison;
  }

  return getTeamPairingSignature(left).localeCompare(getTeamPairingSignature(right));
}

function getTeamRatingDifference(teams: Team[]) {
  return Math.abs(getTeamRating(teams[0]) - getTeamRating(teams[1]));
}

function getStrongestTeamRating(teams: Team[]) {
  return Math.max(...teams.map(getTeamRating));
}

function getTeamRating(team: Team) {
  return team.players.reduce((total, player) => total + (player.dupr ?? 3.0), 0);
}

function getTeamPairingSignature(teams: Team[]) {
  return teams
    .map((team) => team.players.map((player) => player.id).sort((left, right) => left - right).join('-'))
    .sort()
    .join('|');
}

function compareSkillBalancedPairings(left: Team[], right: Team[]) {
  const skillDifferenceComparison = getSkillRatingDifference(left) - getSkillRatingDifference(right);

  if (skillDifferenceComparison !== 0) {
    return skillDifferenceComparison;
  }

  const strongerSkillComparison = getStrongestSkillRating(left) - getStrongestSkillRating(right);

  if (strongerSkillComparison !== 0) {
    return strongerSkillComparison;
  }

  const duprDifferenceComparison = getTeamRatingDifference(left) - getTeamRatingDifference(right);

  if (duprDifferenceComparison !== 0) {
    return duprDifferenceComparison;
  }

  return getTeamPairingSignature(left).localeCompare(getTeamPairingSignature(right));
}

function getSkillRatingDifference(teams: Team[]) {
  return Math.abs(getSkillRating(teams[0]) - getSkillRating(teams[1]));
}

function getStrongestSkillRating(teams: Team[]) {
  return Math.max(...teams.map(getSkillRating));
}

function getSkillRating(team: Team) {
  return team.players.reduce((total, player) => total + getSkillLevelValue(player.skillLevel), 0);
}

function getSkillLevelValue(skillLevel: Player['skillLevel']) {
  switch (skillLevel) {
    case 'Beginner':
      return 1;
    case 'Novice':
      return 2;
    case 'Intermediate':
      return 3;
    case 'High Intermediate':
      return 4;
    case 'Advanced':
      return 5;
  }
}

function applyPreviewSwap(
  courts: CourtAssignment[],
  orderedPlayers: Player[],
  firstPlayerId: number,
  secondPlayerId: number,
) {
  if (!courts.length) {
    return courts;
  }

  const previewSlots = courts.flatMap((court) => court.teams.flatMap((team) => team.players));
  const nextSlotIds = previewSlots.map((player) => player.id);
  const firstSlotIndex = nextSlotIds.indexOf(firstPlayerId);
  const secondSlotIndex = nextSlotIds.indexOf(secondPlayerId);

  if (firstSlotIndex === -1 && secondSlotIndex === -1) {
    return courts;
  }

  if (firstSlotIndex !== -1 && secondSlotIndex !== -1) {
    [nextSlotIds[firstSlotIndex], nextSlotIds[secondSlotIndex]] = [
      nextSlotIds[secondSlotIndex],
      nextSlotIds[firstSlotIndex],
    ];
  } else if (firstSlotIndex !== -1) {
    nextSlotIds[firstSlotIndex] = secondPlayerId;
  } else {
    nextSlotIds[secondSlotIndex] = firstPlayerId;
  }

  const playersById = new Map(orderedPlayers.map((player) => [player.id, player]));
  const nextPreviewPlayers = nextSlotIds
    .map((id) => playersById.get(id))
    .filter((player): player is Player => !!player);

  if (nextPreviewPlayers.length !== nextSlotIds.length) {
    return courts;
  }

  return buildCourts(nextPreviewPlayers, 'sequential');
}
