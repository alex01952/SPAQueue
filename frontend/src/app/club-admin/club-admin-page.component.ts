import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { getApiBaseUrl } from '../api-base-url';

interface Club {
  clubId: string;
  name: string;
}

interface Member {
  memberId: string;
  name: string;
}

interface ClubAssignment {
  clubId: string;
  memberId: string;
  role?: 'Member' | 'Officer';
}

@Component({
  selector: 'app-club-admin-page',
  templateUrl: './club-admin-page.component.html',
  styleUrl: './club-admin-page.component.scss',
})
export class ClubAdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly clubs = signal<Club[]>([]);
  protected readonly members = signal<Member[]>([]);
  protected readonly assignments = signal<ClubAssignment[]>([]);
  protected readonly newClubName = signal('');
  protected readonly selectedClubId = signal('');
  protected readonly selectedMemberId = signal('');
  protected readonly isCreating = signal(false);
  protected readonly isAssigning = signal(false);
  protected readonly feedbackMessage = signal('');
  protected readonly errorMessage = signal('');

  ngOnInit() {
    this.load();
  }

  protected createClub() {
    const name = this.newClubName().trim();
    if (!name || this.isCreating()) return;

    this.clearMessages();
    this.isCreating.set(true);
    this.http
      .post<Club>(`${getApiBaseUrl()}/admin/clubs`, { name }, { withCredentials: true })
      .subscribe({
        next: (club) => {
          this.clubs.update((clubs) =>
            [...clubs, club].sort((left, right) => left.name.localeCompare(right.name)),
          );
          this.newClubName.set('');
          this.selectedClubId.set(club.clubId);
          this.feedbackMessage.set(`${club.name} was created.`);
          this.isCreating.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(error.error?.message ?? 'Unable to create the club.');
          this.isCreating.set(false);
        },
      });
  }

  protected assignOfficer() {
    const clubId = this.selectedClubId();
    const memberId = this.selectedMemberId();
    if (!clubId || !memberId || this.isAssigning()) return;

    this.clearMessages();
    this.isAssigning.set(true);
    this.http
      .post<ClubAssignment>(
        `${getApiBaseUrl()}/admin/club-members`,
        { clubId, memberId, role: 'Officer' },
        { withCredentials: true },
      )
      .subscribe({
        next: (assignment) => {
          this.assignments.update((items) => [
            ...items.filter(
              (item) => item.clubId !== assignment.clubId || item.memberId !== assignment.memberId,
            ),
            assignment,
          ]);
          this.feedbackMessage.set('Club officer assigned.');
          this.isAssigning.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(error.error?.message ?? 'Unable to assign the officer.');
          this.isAssigning.set(false);
        },
      });
  }

  protected removeOfficer(assignment: ClubAssignment) {
    this.clearMessages();
    this.http
      .delete(
        `${getApiBaseUrl()}/admin/club-members/${encodeURIComponent(assignment.clubId)}/${encodeURIComponent(assignment.memberId)}`,
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.assignments.update((items) => items.filter((item) => item !== assignment));
          this.feedbackMessage.set('Club officer removed.');
        },
        error: (error: HttpErrorResponse) =>
          this.errorMessage.set(error.error?.message ?? 'Unable to remove the officer.'),
      });
  }

  protected clubName(clubId: string) {
    return this.clubs().find((club) => club.clubId === clubId)?.name ?? clubId;
  }

  protected memberName(memberId: string) {
    return this.members().find((member) => member.memberId === memberId)?.name ?? memberId;
  }

  protected officerAssignments() {
    return this.assignments().filter((assignment) => assignment.role === 'Officer');
  }

  private load() {
    this.http.get<Club[]>(`${getApiBaseUrl()}/clubs/options`, { withCredentials: true }).subscribe({
      next: (clubs) => this.clubs.set(clubs),
      error: () => this.errorMessage.set('Unable to load clubs.'),
    });
    this.http.get<Member[]>(`${getApiBaseUrl()}/members`, { withCredentials: true }).subscribe({
      next: (members) => this.members.set(members),
      error: () => this.errorMessage.set('Unable to load approved members.'),
    });
    this.http
      .get<ClubAssignment[]>(`${getApiBaseUrl()}/admin/club-members`, {
        withCredentials: true,
      })
      .subscribe({
        next: (assignments) => this.assignments.set(assignments),
        error: () => this.errorMessage.set('Unable to load club officers.'),
      });
  }

  private clearMessages() {
    this.feedbackMessage.set('');
    this.errorMessage.set('');
  }
}
