import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';

interface MemberSummary {
  memberId: string;
  name: string;
  role: string;
  clubName: string;
  profileImageUrl: string;
  location?: string;
}

interface ClubSummary { clubId: string; name: string; }

@Component({
  selector: 'app-members-page',
  imports: [RouterLink],
  templateUrl: './members-page.component.html',
  styleUrl: './members-page.component.scss',
})
export class MembersPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly searchTerm = signal('');
  protected readonly locationScope = signal('');
  protected readonly selectedLocation = signal('');
  protected readonly selectedClubId = signal('');
  protected readonly sorsogonTowns = [
    'Barcelona', 'Bulan', 'Bulusan', 'Castilla', 'Casiguran', 'Donsol',
    'Gubat', 'Irosin', 'Juban', 'Magallanes', 'Matnog', 'Pilar',
    'Prieto Diaz', 'Santa Magdalena', 'Sorsogon City',
  ];
  protected readonly clubs = signal<ClubSummary[]>([]);
  protected readonly members = signal<MemberSummary[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');

  protected readonly filteredMembers = computed(() => {
    const searchTerm = this.searchTerm().trim().toLowerCase();

    if (!searchTerm) {
      return this.members();
    }

    return this.members().filter((member) =>
      [member.name, member.role, member.clubName].some((value) =>
        value.toLowerCase().includes(searchTerm),
      ),
    );
  });

  ngOnInit() {
    this.loadClubs();
    this.loadMembers();
  }

  protected updateLocationScope(value: string) {
    this.locationScope.set(value);
    this.selectedLocation.set(value === 'Other' ? 'Other' : '');
    this.loadMembers();
  }

  protected updateLocation(value: string) {
    this.selectedLocation.set(value);
    this.loadMembers();
  }
  protected updateClub(value: string) { this.selectedClubId.set(value); this.loadMembers(); }

  private loadClubs() {
    this.http.get<ClubSummary[]>(`${getApiBaseUrl()}/clubs/options`, { withCredentials: true })
      .subscribe({ next: (clubs) => this.clubs.set(clubs), error: () => this.clubs.set([]) });
  }

  protected loadMembers() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    const params = new URLSearchParams();
    if (this.selectedLocation()) params.set('location', this.selectedLocation());
    if (this.selectedClubId()) params.set('clubId', this.selectedClubId());
    this.http
      .get<MemberSummary[]>(`${getApiBaseUrl()}/members${params.toString() ? `?${params}` : ''}`, {
        withCredentials: true,
      })
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.members.set([]);
          this.isLoading.set(false);
          this.errorMessage.set(
            error.status === 401
              ? 'Your member session has expired. Sign in again to view the directory.'
              : 'Unable to load the member directory. Please try again.',
          );
        },
      });
  }

  protected updateSearchTerm(value: string) {
    this.searchTerm.set(value);
  }

  protected memberInitials(name: string) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }
}