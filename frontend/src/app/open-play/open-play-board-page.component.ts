import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, switchMap, timer } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { formatBenchTime, OpenPlayCategory } from './open-play-players';
import { MatchingMode, MatchingPlayer } from './open-play-matching';

interface BoardPlayer extends MatchingPlayer {
  name: string;
  losses: number;
  available: boolean;
  membershipType: 'non-member' | 'member' | 'gold-member';
}

interface BoardTopPlayer {
  id: string;
  name: string;
  wins: number;
  losses: number;
  games: number;
  percent: number;
  membershipType: 'non-member' | 'member' | 'gold-member';
}

interface OpenPlayBoard {
  active: boolean;
  activeCourts?: Array<{ number: number; name: string; startedAt: string }>;
  regularLine: BoardPlayer[];
  winnersLine: BoardPlayer[];
  topFive: BoardTopPlayer[];
  playerLocks: string[][];
  matchingMode: MatchingMode;
  forcedCategory: OpenPlayCategory | null;
  secondaryEnabled?: boolean;
  secondaryForcedCategory?: OpenPlayCategory | null;
  nextPlayerIds: string[] | null;
  followingPlayerIds?: string[] | null;
  secondaryNextPlayerIds?: string[] | null;
  tieBreakSeed?: number;
}

@Component({
  selector: 'app-open-play-board-page',
  imports: [DecimalPipe],
  templateUrl: './open-play-board-page.component.html',
  styleUrl: './open-play-board-page.component.scss',
})
export class OpenPlayBoardPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = getApiBaseUrl();
  protected readonly board = signal<OpenPlayBoard | null>(null);
  protected readonly feedState = signal('Connecting');
  protected readonly now = signal(Date.now());
  protected readonly formatBenchTime = formatBenchTime;

  protected courtElapsedTime(startedAt: string) {
    const start = Date.parse(startedAt);
    const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((this.now() - start) / 1000)) : 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remainder = String(seconds % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${String(minutes).padStart(2, '0')}:${remainder}`;
  }
  protected readonly nextPlayerSlots = computed<(BoardPlayer | null)[]>(() => {
    const board = this.board();
    if (!board) return [null, null, null, null];
    const byId = new Map([...board.regularLine, ...board.winnersLine].map((player) => [player.id, player]));
    return (board.nextPlayerIds ?? ['', '', '', '']).map((id) => id ? byId.get(id) ?? null : null);
  });
  protected readonly followingPlayerSlots = computed<(BoardPlayer | null)[]>(() => {
    const board = this.board();
    const byId = new Map([...(board?.regularLine ?? []), ...(board?.winnersLine ?? [])].map((player) => [player.id, player]));
    return (board?.followingPlayerIds ?? ['', '', '', '']).map((id) => id ? byId.get(id) ?? null : null);
  });

  ngOnInit() {
    timer(0, 1000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.now.set(Date.now()));
    timer(0, 15 * 60 * 1000).pipe(
      switchMap(() => this.http.post(`${this.apiUrl}/members/session/refresh`, {}, { withCredentials: true }).pipe(
        catchError(() => EMPTY),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    timer(0, 5000).pipe(
      switchMap(() => this.http.get<OpenPlayBoard>(`${this.apiUrl}/open-play/board`, { withCredentials: true }).pipe(
        catchError(() => {
          this.feedState.set(this.board() ? 'Reconnecting' : 'Unavailable');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((board) => {
      this.board.set(board);
      this.feedState.set('Live');
    });
  }
}