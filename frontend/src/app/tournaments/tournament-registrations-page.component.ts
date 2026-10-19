import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { MemberProfileFrameComponent } from '../member-profile/member-profile-frame.component';
import type { Tournament, TournamentRegistration } from './tournament.types';

type RegistrationStatusFilter = 'All' | TournamentRegistration['status'];

@Component({
  selector: 'app-tournament-registrations-page',
  imports: [DatePipe, FormsModule, RouterLink, MemberProfileFrameComponent],
  templateUrl: './tournament-registrations-page.component.html',
  styleUrl: './tournament-registrations-page.component.scss',
})
export class TournamentRegistrationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly apiUrl = getApiBaseUrl();

  protected readonly tournaments = signal<Tournament[]>([]);
  protected readonly registrations = signal<TournamentRegistration[]>([]);
  protected readonly selectedTournamentId = signal('');
  protected readonly profileMember = signal<{ memberId: string; name: string } | null>(null);
  protected readonly statusFilter = signal<RegistrationStatusFilter>('All');
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly isWorking = signal(false);
  protected readonly statusFilters: { label: string; value: RegistrationStatusFilter }[] = [
    { label: 'All', value: 'All' },
    { label: 'Awaiting partner', value: 'Invitation Pending' },
    { label: 'Accepted', value: 'Pending Approval' },
    { label: 'Approved', value: 'Approved' },
    { label: 'Declined', value: 'Invitation Declined' },
    { label: 'Payment submitted', value: 'Payment Submitted' },
    { label: 'Paid', value: 'Paid' },
  ];
  protected readonly selectedTournament = computed(() =>
    this.tournaments().find((item) => item.tournamentId === this.selectedTournamentId()) ?? null,
  );
  protected readonly tournamentRegistrations = computed(() =>
    this.registrations().filter((item) => item.tournamentId === this.selectedTournamentId()),
  );
  protected readonly approvedTeamCount = computed(() =>
    this.tournamentRegistrations().filter((item) => ['Approved', 'Payment Submitted', 'Paid'].includes(item.status)).length,
  );
  protected readonly pendingTeamCount = computed(() =>
    this.tournamentRegistrations().filter((item) => ['Invitation Pending', 'Pending Approval'].includes(item.status)).length,
  );
  protected readonly filteredRegistrations = computed(() => {
    const status = this.statusFilter();
    const items = this.tournamentRegistrations();
    return status === 'All' ? items : items.filter((item) => item.status === status);
  });

  ngOnInit() {
    this.loadData();
  }

  protected setTournament(tournamentId: string) {
    this.selectedTournamentId.set(tournamentId);
    this.statusFilter.set('All');
  }

  protected setStatusFilter(status: RegistrationStatusFilter) {
    this.statusFilter.set(status);
  }

  protected memberProfileHref(memberId: string): string {
    return `/member-profile/${encodeURIComponent(memberId)}`;
  }

  protected openMemberProfile(memberId: string, name: string, event: MouseEvent) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.profileMember.set({ memberId, name });
  }

  protected closeMemberProfile() {
    this.profileMember.set(null);
  }

  protected countForStatus(status: RegistrationStatusFilter): number {
    if (status === 'All') return this.tournamentRegistrations().length;
    return this.tournamentRegistrations().filter((item) => item.status === status).length;
  }

  protected statusLabel(status: TournamentRegistration['status']): string {
    switch (status) {
      case 'Invitation Pending': return 'Awaiting partner';
      case 'Pending Approval': return 'Accepted · awaiting admin';
      case 'Invitation Declined': return 'Declined';
      case 'Payment Submitted': return 'Payment submitted';
      default: return status;
    }
  }

  protected statusClass(status: TournamentRegistration['status']): string {
    return status.toLowerCase().replaceAll(' ', '-');
  }

  protected canMarkPaid(registration: TournamentRegistration): boolean {
    return registration.status === 'Approved' || registration.status === 'Payment Submitted';
  }

  protected markPaid(registration: TournamentRegistration) {
    if (this.isWorking() || !this.canMarkPaid(registration)) return;
    if (!window.confirm('Confirm that payment has been received for this team? Marking it paid locks all player changes, even if no proof has been uploaded.')) return;
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<TournamentRegistration>(
      `${this.apiUrl}/admin/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/paid`,
      {}, { withCredentials: true },
    ).subscribe({
      next: (updated) => {
        this.registrations.update((items) => items.map((item) =>
          item.tournamentId === updated.tournamentId && item.registrationId === updated.registrationId ? updated : item,
        ));
        this.feedbackMessage.set('Registration marked as paid. Player changes are now locked.');
        this.isWorking.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Unable to mark this registration as paid.');
        this.isWorking.set(false);
      },
    });
  }

  protected removeRegistration(registration: TournamentRegistration) {
    if (this.isWorking()) return;
    if (!window.confirm(`Remove this ${registration.status === 'Paid' ? 'PAID ' : ''}registration for all team members? This releases the slot but does not issue a refund.`)) return;
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.delete<{ deleted: true }>(
      `${this.apiUrl}/admin/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}`,
      { withCredentials: true },
    ).subscribe({
      next: () => {
        this.registrations.update((items) => items.filter((item) =>
          item.tournamentId !== registration.tournamentId || item.registrationId !== registration.registrationId,
        ));
        this.feedbackMessage.set('Registration removed for all team members.');
        this.isWorking.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Unable to remove this registration.');
        this.isWorking.set(false);
      },
    });
  }

  private loadData() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    forkJoin({
      tournaments: this.http.get<Tournament[]>(`${this.apiUrl}/tournaments`, { withCredentials: true }),
      registrations: this.http.get<TournamentRegistration[]>(`${this.apiUrl}/admin/tournament-registrations`, { withCredentials: true }),
    }).subscribe({
      next: ({ tournaments, registrations }) => {
        this.tournaments.set(tournaments);
        this.registrations.set(registrations);
        const requestedTournamentId = this.route.snapshot.queryParamMap.get('tournamentId') ?? '';
        if (tournaments.some((item) => item.tournamentId === requestedTournamentId)) {
          this.selectedTournamentId.set(requestedTournamentId);
        }
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.message ?? 'Tournament registrations could not be loaded.');
        this.isLoading.set(false);
      },
    });
  }
}