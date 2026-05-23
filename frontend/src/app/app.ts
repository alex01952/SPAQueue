import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

interface Player {
  id: number;
  name: string;
  dupr: number | null;
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

interface CourtAssignment {
  courtNumber: number;
  players: Player[];
  teams: Team[];
}

interface SwapSelection {
  playerId: number;
}

interface Game {
  id: number;
  status: 'ongoing' | 'completed';
  createdAt: string;
  completedAt: string | null;
  score: GameScore | null;
  players: Player[];
  teams: Team[];
}

interface QueueSnapshot {
  players: Player[];
  ongoingGames: Game[];
  recentGames: Game[];
  nextGame: {
    courtCount: number;
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

  protected readonly snapshot = signal<QueueSnapshot | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isMutating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly courtCount = signal(1);
  protected readonly scoreDrafts = signal<Record<number, ScoreDraft>>({});
  protected readonly eligiblePlayerOrder = signal<Player[]>([]);
  protected readonly swapSelection = signal<SwapSelection | null>(null);
  protected readonly readyCount = computed(
    () => this.snapshot()?.players.filter((player) => player.isReady).length ?? 0,
  );
  protected readonly availableCount = computed(
    () =>
      this.snapshot()?.players.filter((player) => player.isReady && !player.isPlaying).length ?? 0,
  );
  protected readonly requiredPlayers = computed(() => this.courtCount() * 4);
  protected readonly selectedPreviewPlayers = computed(() =>
    this.eligiblePlayerOrder().slice(0, this.requiredPlayers()),
  );
  protected readonly selectedPreviewCourts = computed(() =>
    buildCourts(this.selectedPreviewPlayers()),
  );

  ngOnInit() {
    this.loadSnapshot();
  }

  protected toggleReady(player: Player) {
    this.runMutation(
      this.http.patch<Player>(`${this.apiBaseUrl}/players/${player.id}/ready`, {
        isReady: !player.isReady,
      }),
    );
  }

  protected startNextGame() {
    const playerGroups = this.selectedPreviewCourts().map((court) =>
      court.players.map((player) => player.id),
    );

    if (playerGroups.length !== this.courtCount()) {
      return;
    }

    this.runMutation(this.http.post<Game[]>(`${this.apiBaseUrl}/games/batch`, { playerGroups }));
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
      this.http.patch<Game>(`${this.apiBaseUrl}/games/${gameId}/complete`, {
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

    this.eligiblePlayerOrder.update((players) => {
      const firstIndex = players.findIndex((player) => player.id === currentSelection.playerId);
      const secondIndex = players.findIndex((player) => player.id === playerId);

      if (firstIndex === -1 || secondIndex === -1) {
        return players;
      }

      const nextPlayers = [...players];
      [nextPlayers[firstIndex], nextPlayers[secondIndex]] = [
        nextPlayers[secondIndex],
        nextPlayers[firstIndex],
      ];
      return nextPlayers;
    });

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

  private loadSnapshot() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http
      .get<QueueSnapshot>(`${this.apiBaseUrl}/queue`, {
        params: {
          courtCount: this.courtCount(),
        },
      })
      .subscribe({
      next: (snapshot) => {
        this.snapshot.set(snapshot);
        this.eligiblePlayerOrder.set(snapshot.nextGame.eligiblePlayers);
        this.swapSelection.set(null);
        this.primeScoreDrafts(snapshot.ongoingGames);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set(
          'The API is unavailable. Start the Nest server on port 3000 to load live queue data.',
        );
        this.isLoading.set(false);
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
}

function buildCourts(players: Player[]): CourtAssignment[] {
  const courts: CourtAssignment[] = [];

  for (let index = 0; index < players.length; index += 4) {
    const courtPlayers = players.slice(index, index + 4);

    if (courtPlayers.length < 4) {
      break;
    }

    courts.push({
      courtNumber: courts.length + 1,
      players: courtPlayers,
      teams: buildTeams(courtPlayers),
    });
  }

  return courts;
}

function buildTeams(players: Player[]): Team[] {
  if (players.length !== 4) {
    return [];
  }

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
