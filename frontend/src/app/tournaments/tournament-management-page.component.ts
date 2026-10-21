import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
  imports: [DatePipe, FormsModule, RouterLink],
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
  protected readonly termsFile = signal<File | null>(null);
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

  protected selectTermsFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    this.termsFile.set(null);
    this.errorMessage.set('');
    if (!file) return;
    if (file.type !== 'application/pdf' || !file.size || file.size > 10 * 1024 * 1024) {
      input.value = '';
      this.errorMessage.set('Terms and conditions must be a PDF file no larger than 10 MB.');
      return;
    }
    this.termsFile.set(file);
  }

  protected createTournament(termsInput: HTMLInputElement) {
    if (this.isSaving()) return;
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.isSaving.set(true);
    const file = this.termsFile();
    const body = new FormData();
    Object.entries(this.form).forEach(([key, value]) => body.append(key, String(value)));
    if (file) body.append('termsFile', file);
    this.http.post<Tournament>(`${this.apiUrl}/admin/tournaments`, body, { withCredentials: true }).subscribe({
      next: () => {
        this.form.name = '';
        this.form.date = '';
        this.form.location = '';
        this.termsFile.set(null);
        termsInput.value = '';
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

  protected toggleRegistration(tournament: Tournament) {
    if (this.isSaving()) return;
    const closed = !tournament.registrationClosed;
    const prompt = closed
      ? `Close registration for ${tournament.name}? Players will no longer be able to register or accept invitations, and confirmed participants will be able to view the roster and file protests.`
      : `Reopen registration for ${tournament.name}? Players will be able to register and accept invitations again, and new protests will be paused.`;
    if (!window.confirm(prompt)) return;
    this.isSaving.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<Tournament>(
      `${this.apiUrl}/admin/tournaments/${encodeURIComponent(tournament.tournamentId)}/registration-status`,
      { closed },
      { withCredentials: true },
    ).subscribe({
      next: (updated) => {
        this.tournaments.update((items) => items.map((item) => item.tournamentId === updated.tournamentId ? updated : item));
        this.feedbackMessage.set(closed ? 'Registration closed.' : 'Registration reopened.');
        this.isSaving.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Unable to update the registration status.');
        this.isSaving.set(false);
      },
    });
  }

  protected archiveTournament(tournament: Tournament) {
    this.changeTournamentLifecycle(tournament, false);
  }

  protected deleteTournament(tournament: Tournament) {
    this.changeTournamentLifecycle(tournament, true);
  }

  private changeTournamentLifecycle(tournament: Tournament, permanent: boolean) {
    if (this.isSaving()) return;
    const prompt = permanent
      ? `Permanently delete "${tournament.name}" and ALL registrations, payment proofs, protests, evidence, terms, pools and schedules? This cannot be undone and does not issue refunds.`
      : `Archive "${tournament.name}"? It will be removed from active tournaments. All related records and files will remain available read-only in Archived tournaments.`;
    if (!window.confirm(prompt)) return;
    this.isSaving.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    const url = `${this.apiUrl}/admin/tournaments/${encodeURIComponent(tournament.tournamentId)}`;
    const request = permanent
      ? this.http.delete(`${url}`, { withCredentials: true })
      : this.http.post(`${url}/archive`, {}, { withCredentials: true });
    request.subscribe({
      next: () => {
        this.tournaments.update((items) => items.filter((item) => item.tournamentId !== tournament.tournamentId));
        this.registrations.update((items) => items.filter((item) => item.tournamentId !== tournament.tournamentId));
        this.feedbackMessage.set(permanent ? 'Tournament and related data permanently deleted.' : 'Tournament archived.');
        this.isSaving.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showError(error, 'Unable to complete the operation. Retry the same action to finish.');
        this.isSaving.set(false);
      },
    });
  }

  protected pendingApprovals() {
    return this.registrations().filter((item) => item.status === 'Pending Approval');
  }

  protected teamMemberNames(registration: TournamentRegistration): string {
    return registration.teamMembers?.length
      ? registration.teamMembers.map((member) => member.name).join(' + ')
      : `${registration.memberName} + ${registration.partnerName}`;
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