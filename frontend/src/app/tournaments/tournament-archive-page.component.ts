import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import { ArchivedTournament, TournamentArchiveDetails, TournamentRegistration } from './tournament.types';

@Component({
  selector: 'app-tournament-archive-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './tournament-archive-page.component.html',
  styleUrl: './tournament-management-page.component.scss',
})
export class TournamentArchivePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = getApiBaseUrl();
  protected readonly tournaments = signal<ArchivedTournament[]>([]);
  protected readonly details = signal<TournamentArchiveDetails | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly feedback = signal('');

  ngOnInit() { this.load(); }

  protected load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.http.get<ArchivedTournament[]>(`${this.apiUrl}/admin/tournament-archive`, { withCredentials: true }).subscribe({
      next: (items) => { this.tournaments.set(items); this.busy.set(false); },
      error: (error: HttpErrorResponse) => this.fail(error, 'Unable to load archived tournaments.'),
    });
  }

  protected view(tournament: ArchivedTournament) {
    if (this.busy()) return;
    this.busy.set(true);
    this.details.set(null);
    this.error.set('');
    this.http.get<TournamentArchiveDetails>(
      `${this.apiUrl}/admin/tournament-archive/${encodeURIComponent(tournament.tournamentId)}`, { withCredentials: true },
    ).subscribe({
      next: (details) => { this.details.set(details); this.busy.set(false); },
      error: (error: HttpErrorResponse) => this.fail(error, 'Unable to load archived tournament details.'),
    });
  }

  protected remove(tournament: ArchivedTournament) {
    if (this.busy() || !window.confirm(
      `Permanently delete archived tournament "${tournament.name}" and ALL related records and files? This cannot be undone and does not issue refunds.`,
    )) return;
    this.busy.set(true);
    this.error.set('');
    this.feedback.set('');
    this.http.delete(
      `${this.apiUrl}/admin/tournament-archive/${encodeURIComponent(tournament.tournamentId)}`, { withCredentials: true },
    ).subscribe({
      next: () => {
        this.tournaments.update((items) => items.filter((item) => item.tournamentId !== tournament.tournamentId));
        if (this.details()?.tournament.tournamentId === tournament.tournamentId) this.details.set(null);
        this.feedback.set('Archived tournament and related data permanently deleted.');
        this.busy.set(false);
      },
      error: (error: HttpErrorResponse) => this.fail(error, 'Unable to delete the tournament. Retry to finish the deletion.'),
    });
  }

  protected teamNames(registration: TournamentRegistration) {
    return registration.teamMembers?.length
      ? registration.teamMembers.map((member) => member.name).join(' + ')
      : `${registration.memberName} + ${registration.partnerName}`;
  }

  protected teamLabel(registrationId: string) {
    const registration = this.details()?.registrations.find((item) => item.registrationId === registrationId);
    return registration ? this.teamNames(registration) : registrationId;
  }

  protected assetUrl(path: string) { return `${this.apiUrl}${path}`; }

  private fail(error: HttpErrorResponse, fallback: string) {
    this.error.set(error.error?.message ?? fallback);
    this.busy.set(false);
  }
}
