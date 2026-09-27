import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { getApiBaseUrl } from './api-base-url';

interface Club { clubId: string; name: string; }
interface ClubJoinRequest {
  clubId: string;
  memberId: string;
  memberName: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedAt: string;
}

@Component({
  selector: 'app-club-join-requests-page',
  imports: [DatePipe],
  templateUrl: './club-join-requests-page.component.html',
  styleUrl: './club-join-requests-page.component.scss',
})
export class ClubJoinRequestsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly clubs = signal<Club[]>([]);
  protected readonly selectedClubId = signal('');
  protected readonly requests = signal<ClubJoinRequest[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');

  ngOnInit() {
    this.http.get<Club[]>(`${getApiBaseUrl()}/clubs/options`, { withCredentials: true }).subscribe({
      next: (clubs) => this.clubs.set(clubs),
      error: (error: HttpErrorResponse) => this.errorMessage.set(error.error?.message ?? 'Unable to load clubs.'),
    });
  }

  protected selectClub(clubId: string) {
    this.selectedClubId.set(clubId);
    this.loadRequests();
  }

  protected review(request: ClubJoinRequest, decision: 'Approved' | 'Rejected') {
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<ClubJoinRequest>(
      `${getApiBaseUrl()}/clubs/${encodeURIComponent(request.clubId)}/join-requests/${encodeURIComponent(request.memberId)}`,
      { decision },
      { withCredentials: true },
    ).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.memberId !== request.memberId));
        this.feedbackMessage.set(decision === 'Approved' ? 'Member approved and added to the club.' : 'Join request rejected.');
      },
      error: (error: HttpErrorResponse) => this.errorMessage.set(error.error?.message ?? 'Unable to review join request.'),
    });
  }

  private loadRequests() {
    const clubId = this.selectedClubId();
    this.requests.set([]);
    this.errorMessage.set('');
    if (!clubId) return;
    this.isLoading.set(true);
    this.http.get<ClubJoinRequest[]>(
      `${getApiBaseUrl()}/clubs/${encodeURIComponent(clubId)}/join-requests/pending`,
      { withCredentials: true },
    ).subscribe({
      next: (requests) => { this.requests.set(requests); this.isLoading.set(false); },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.status === 403 ? 'You are not an officer of this club.' : error.error?.message ?? 'Unable to load join requests.');
        this.isLoading.set(false);
      },
    });
  }
}
