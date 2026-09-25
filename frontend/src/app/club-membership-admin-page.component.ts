import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { getApiBaseUrl } from './api-base-url';

interface Member { memberId: string; name: string; }
interface Club { clubId: string; name: string; }
interface Assignment { clubId: string; memberId: string; }

@Component({
  selector: 'app-club-membership-admin-page',
  imports: [],
  templateUrl: './club-membership-admin-page.component.html',
  styleUrl: './club-membership-admin-page.component.scss',
})
export class ClubMembershipAdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly members = signal<Member[]>([]);
  protected readonly clubs = signal<Club[]>([]);
  protected readonly assignments = signal<Assignment[]>([]);
  protected readonly selectedMemberId = signal('');
  protected readonly selectedClubId = signal('');
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');

  ngOnInit() {
    this.load();
  }

  protected assigned(clubId: string, memberId: string) {
    return this.assignments().some((item) => item.clubId === clubId && item.memberId === memberId);
  }

  protected assign() {
    if (!this.selectedMemberId() || !this.selectedClubId()) return;
    this.http.post<Assignment>(`${getApiBaseUrl()}/admin/club-members`, {
      memberId: this.selectedMemberId(), clubId: this.selectedClubId(),
    }, { withCredentials: true }).subscribe({
      next: (assignment) => {
        this.assignments.update((items) => [...items.filter((item) => !(item.clubId === assignment.clubId && item.memberId === assignment.memberId)), assignment]);
        this.feedbackMessage.set('Member assigned to club.');
      },
      error: (error: HttpErrorResponse) => this.errorMessage.set(error.error?.message ?? 'Unable to assign member.'),
    });
  }

  protected remove(assignment: Assignment) {
    this.http.delete(`${getApiBaseUrl()}/admin/club-members/${encodeURIComponent(assignment.clubId)}/${encodeURIComponent(assignment.memberId)}`, { withCredentials: true }).subscribe({
      next: () => {
        this.assignments.update((items) => items.filter((item) => item !== assignment));
        this.feedbackMessage.set('Member removed from club.');
      },
      error: () => this.errorMessage.set('Unable to remove member from club.'),
    });
  }

  private load() {
    this.http.get<Member[]>(`${getApiBaseUrl()}/members`, { withCredentials: true }).subscribe({ next: (members) => this.members.set(members), error: () => this.errorMessage.set('Unable to load members.') });
    this.http.get<Club[]>(`${getApiBaseUrl()}/clubs/options`, { withCredentials: true }).subscribe({ next: (clubs) => this.clubs.set(clubs), error: () => this.errorMessage.set('Unable to load clubs.') });
    this.http.get<Assignment[]>(`${getApiBaseUrl()}/admin/club-members`, { withCredentials: true }).subscribe({ next: (items) => this.assignments.set(items), error: () => this.errorMessage.set('Unable to load assignments.') });
  }
}
