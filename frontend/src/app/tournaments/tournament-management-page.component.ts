import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getApiBaseUrl } from '../api-base-url';
import {
  tournamentCategories,
  tournamentLevels,
  type TournamentExperienceDetails,
  type Tournament,
  type TournamentRegistration,
} from './tournament.types';

@Component({
  selector: 'app-tournament-management-page',
  imports: [DatePipe, FormsModule],
  templateUrl: './tournament-management-page.component.html',
  styleUrl: './tournament-management-page.component.scss',
})
export class TournamentManagementPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = getApiBaseUrl();

  protected readonly categories = tournamentCategories;
  protected readonly levels = tournamentLevels;
  protected readonly tournaments = signal<Tournament[]>([]);
  protected readonly registrations = signal<TournamentRegistration[]>([]);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly form = {
    name: '',
    category: tournamentCategories[0],
    level: tournamentLevels[0],
    maxSlots: 16,
    date: '',
    location: '',
  };

  ngOnInit() {
    this.loadData();
  }

  protected createTournament() {
    if (this.isSaving()) return;
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.isSaving.set(true);
    this.http.post<Tournament>(`${this.apiUrl}/admin/tournaments`, this.form, { withCredentials: true }).subscribe({
      next: () => {
        this.form.name = '';
        this.form.date = '';
        this.form.location = '';
        this.feedbackMessage.set('Tournament created.');
        this.isSaving.set(false);
        this.loadData();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Unable to create tournament.');
        this.isSaving.set(false);
      },
    });
  }

  protected approve(registration: TournamentRegistration) {
    if (this.isSaving()) return;
    this.isSaving.set(true);
    this.errorMessage.set('');
    this.http.patch<TournamentRegistration>(
      `${this.apiUrl}/admin/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/approve`,
      {},
      { withCredentials: true },
    ).subscribe({
      next: () => {
        this.feedbackMessage.set('Team registration approved.');
        this.isSaving.set(false);
        this.loadData();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Unable to approve registration.');
        this.isSaving.set(false);
      },
    });
  }

  protected pendingApprovals() {
    return this.registrations().filter((item) => item.status === 'Pending Approval');
  }

  protected experienceSummary(name: string, details?: TournamentExperienceDetails): string {
    if (!details) return `${name}: answers not recorded`;
    const participation = details.hasJoinedTournaments
      ? `joined tournaments, highest ${details.highestTournamentLevel}`
      : 'no previous tournament entries';
    const results = details.hasWonTournaments
      ? `${details.winsOrPodiums} wins or podium finishes at ${details.highestWinningLevel}`
      : 'no tournament wins or podium finishes';
    return `${name}: ${participation}; ${results}.`;
  }

  private loadData() {
    this.http.get<Tournament[]>(`${this.apiUrl}/tournaments`, { withCredentials: true }).subscribe({
      next: (items) => this.tournaments.set(items),
      error: (error: HttpErrorResponse) => this.showError(error, 'Unable to load tournaments.'),
    });
    this.http.get<TournamentRegistration[]>(`${this.apiUrl}/admin/tournament-registrations`, { withCredentials: true }).subscribe({
      next: (items) => this.registrations.set(items),
      error: (error: HttpErrorResponse) => this.showError(error, 'Unable to load team registrations.'),
    });
  }

  private showError(error: HttpErrorResponse, fallback: string) {
    this.errorMessage.set(error.error?.message ?? fallback);
  }
}