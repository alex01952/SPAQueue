import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';

interface LeaderboardEntry {
  name: string;
  profileImageUrl: string;
  wins: number;
  losses: number;
  games: number;
  percent: number;
}

interface Leaderboard {
  month: string;
  year: string;
  monthly: LeaderboardEntry[];
  annual: LeaderboardEntry[];
}

@Component({
  selector: 'app-open-play-leaderboard',
  imports: [DecimalPipe],
  templateUrl: './open-play-leaderboard.component.html',
  styleUrl: './open-play-leaderboard.component.scss',
})
export class OpenPlayLeaderboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly apiBaseUrl = getApiBaseUrl();
  protected readonly leaderboard = signal<Leaderboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly failedImages = signal(new Set<string>());

  ngOnInit() { this.load(); }

  protected onImageError(url: string) {
    this.failedImages.update((failed) => new Set(failed).add(url));
  }

  protected load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.http.get<Leaderboard>(`${getApiBaseUrl()}/open-play/leaderboard`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => { this.failedImages.set(new Set()); this.leaderboard.set(result); this.loading.set(false); },
        error: () => { this.error.set('Unable to load the leaderboard. Please try again.'); this.loading.set(false); },
      });
  }
}

@Component({
  selector: 'app-open-play-leaderboard-page',
  imports: [OpenPlayLeaderboardComponent, RouterLink],
  template: '<main class="leaderboard-page"><a routerLink="/home">Back to Member Home</a><app-open-play-leaderboard /></main>',
  styles: '.leaderboard-page { max-width: 1200px; margin: auto; padding: 2rem 1rem; }',
})
export class OpenPlayLeaderboardPageComponent {}
