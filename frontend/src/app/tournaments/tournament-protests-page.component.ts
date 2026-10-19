import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import type { TournamentProtest, TournamentProtestStatus } from './tournament.types';

type ProtestStatusFilter = 'All' | TournamentProtestStatus;

@Component({
  selector: 'app-tournament-protests-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './tournament-protests-page.component.html',
  styleUrl: './tournament-protests-page.component.scss',
})
export class TournamentProtestsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly apiUrl = getApiBaseUrl();

  protected readonly protests = signal<TournamentProtest[]>([]);
  protected readonly selectedTournamentId = signal('');
  protected readonly statusFilter = signal<ProtestStatusFilter>('Open');
  protected readonly isLoading = signal(true);
  protected readonly workingProtestId = signal('');
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly statusFilters: ProtestStatusFilter[] = ['Open', 'Upheld', 'Dismissed', 'All'];
  protected readonly reviewNotes: Record<string, string> = {};

  protected readonly tournamentOptions = computed(() => {
    const options = new Map<string, string>();
    this.protests().forEach((protest) => options.set(protest.tournamentId, protest.tournamentName));
    return [...options].map(([tournamentId, name]) => ({ tournamentId, name }));
  });
  protected readonly filteredProtests = computed(() => {
    const tournamentId = this.selectedTournamentId();
    const status = this.statusFilter();
    return this.protests().filter(
      (protest) => (!tournamentId || protest.tournamentId === tournamentId) && (status === 'All' || protest.status === status),
    );
  });

  ngOnInit() {
    this.selectedTournamentId.set(this.route.snapshot.queryParamMap.get('tournamentId') ?? '');
    this.http.get<TournamentProtest[]>(`${this.apiUrl}/admin/tournament-protests`, { withCredentials: true }).subscribe({
      next: (items) => {
        this.protests.set(items);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to load tournament protests.'));
        this.isLoading.set(false);
      },
    });
  }

  protected setTournament(tournamentId: string) {
    this.selectedTournamentId.set(tournamentId);
  }

  protected setStatusFilter(status: ProtestStatusFilter) {
    this.statusFilter.set(status);
  }

  protected review(protest: TournamentProtest, status: 'Upheld' | 'Dismissed') {
    const verb = status === 'Upheld' ? 'uphold' : 'dismiss';
    if (!window.confirm(`Are you sure you want to ${verb} the protest against ${protest.protestedMemberName}?`)) return;
    this.workingProtestId.set(protest.protestId);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<TournamentProtest>(
      `${this.apiUrl}/admin/tournaments/${encodeURIComponent(protest.tournamentId)}/protests/${encodeURIComponent(protest.protestId)}`,
      { status, note: (this.reviewNotes[protest.protestId] ?? '').trim() },
      { withCredentials: true },
    ).subscribe({
      next: (updated) => {
        this.protests.update((items) => items.map((item) => (item.protestId === updated.protestId ? updated : item)));
        this.feedbackMessage.set(`Protest against ${updated.protestedMemberName} marked ${updated.status}.`);
        this.workingProtestId.set('');
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to review this protest.'));
        this.workingProtestId.set('');
      },
    });
  }

  private errorText(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) return 'Unable to reach the API. Check your connection and try again.';
    const message = error.error?.message;
    return Array.isArray(message) ? message.join(' ') : (message ?? fallback);
  }
}
