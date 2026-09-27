import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';

interface Club { clubId: string; name: string; }
interface JoinRequest { clubId: string; status: 'Pending' | 'Approved' | 'Rejected'; }

@Component({
  selector: 'app-clubs-page',
  imports: [RouterLink],
  templateUrl: './clubs-page.component.html',
  styleUrl: './clubs-page.component.scss',
})
export class ClubsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly clubs = signal<Club[]>([]);
  protected readonly requests = signal<JoinRequest[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/Logo.png';

  ngOnInit() { this.load(); }

  protected requestToJoin(club: Club) {
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.post<JoinRequest>(`${getApiBaseUrl()}/clubs/${encodeURIComponent(club.clubId)}/join-requests`, {}, { withCredentials: true }).subscribe({
      next: (request) => {
        this.requests.update((current) => [...current.filter((item) => item.clubId !== request.clubId), request]);
        this.feedbackMessage.set(`Your request to join ${club.name} was sent.`);
      },
      error: (error: HttpErrorResponse) => this.errorMessage.set(error.error?.message ?? 'Unable to request club membership.'),
    });
  }

  protected requestStatus(clubId: string) {
    return this.requests().find((request) => request.clubId === clubId)?.status ?? '';
  }

  private load() {
    this.isLoading.set(true);
    this.http.get<Club[]>(`${getApiBaseUrl()}/clubs/options`, { withCredentials: true }).subscribe({
      next: (clubs) => { this.clubs.set(clubs); this.isLoading.set(false); },
      error: (error: HttpErrorResponse) => { this.errorMessage.set(error.error?.message ?? 'Unable to load clubs.'); this.isLoading.set(false); },
    });
    this.http.get<JoinRequest[]>(`${getApiBaseUrl()}/clubs/me/join-requests`, { withCredentials: true }).subscribe({
      next: (requests) => this.requests.set(requests),
      error: () => undefined,
    });
  }
}