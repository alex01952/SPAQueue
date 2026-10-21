import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import type { TournamentPlanningState } from './tournament.types';

@Component({
  selector: 'app-tournament-planning-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './tournament-planning-page.component.html',
  styleUrl: './tournament-planning-page.component.scss',
})
export class TournamentPlanningPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
  private readonly url = `${getApiBaseUrl()}/admin/tournaments/${encodeURIComponent(this.tournamentId)}/planning`;
  protected readonly state = signal<TournamentPlanningState | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly saving = signal<'pools' | 'schedule' | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected poolCount = 1;
  protected courtCount = 1;
  protected readonly maxPools = computed(() =>
    Math.floor((this.state()?.roster.teams.length ?? 0) / 2),
  );
  protected readonly matchCount = computed(() =>
    this.state()?.draw?.schedule.reduce((total, slot) => total + slot.matches.length, 0) ?? 0,
  );

  ngOnInit() {
    this.load();
  }

  protected load() {
    if (this.saving()) return;
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.get<TournamentPlanningState>(this.url, { withCredentials: true }).subscribe({
      next: (state) => {
        this.applyState(state);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to load tournament planning.'));
        this.isLoading.set(false);
      },
    });
  }

  protected validCount(count: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
    return Number.isSafeInteger(count) && count >= 1 && count <= maximum;
  }

  protected randomizePools() {
    if (!this.state() || this.saving() || this.isLoading()) return;
    if (!this.validCount(this.poolCount, this.maxPools())) {
      this.errorMessage.set(`Enter a whole number from 1 to ${this.maxPools()} for pools. Each pool needs at least two teams.`);
      return;
    }
    if (this.state()?.draw && !window.confirm(
      'Randomize pools again? This replaces the saved pools and clears the saved schedule for every administrator.',
    )) return;
    this.save('pools', { poolCount: this.poolCount });
  }

  protected generateSchedule() {
    if (!this.state()?.draw || this.saving() || this.isLoading()) return;
    if (!this.validCount(this.courtCount)) {
      this.errorMessage.set('Enter a positive whole number for courts.');
      return;
    }
    if (this.state()?.draw?.schedule.length && !window.confirm(
      'Replace the saved match schedule for every administrator? The pool assignments will stay the same.',
    )) return;
    this.save('schedule', { courtCount: this.courtCount });
  }

  protected teamLabel(registrationId: string): string {
    const team = this.state()?.roster.teams.find((item) => item.registrationId === registrationId);
    return team?.players.map((player) => player.name).join(' + ') ?? registrationId;
  }

  private save(action: 'pools' | 'schedule', count: { poolCount: number } | { courtCount: number }) {
    this.saving.set(action);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.post<TournamentPlanningState>(
      `${this.url}/${action}`,
      { ...count, version: this.state()?.version ?? null },
      { withCredentials: true },
    ).subscribe({
      next: (state) => {
        this.applyState(state);
        this.feedbackMessage.set(action === 'pools'
          ? 'Randomized pools saved. You can now generate the match schedule.'
          : 'Match schedule saved.');
        this.saving.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to save tournament planning.'));
        this.saving.set(null);
      },
    });
  }

  private applyState(state: TournamentPlanningState) {
    this.state.set(state);
    this.poolCount = state.draw?.pools.length ?? 1;
    this.courtCount = state.draw?.courtCount ?? 1;
  }

  private errorText(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) return 'Unable to reach the API. Check your connection and try again.';
    const message = error.error?.message;
    return Array.isArray(message) ? message.join(' ') : message ?? fallback;
  }
}
