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
}

@Component({
  selector: 'app-members-page',
  imports: [RouterLink],
  templateUrl: './members-page.component.html',
  styleUrl: './members-page.component.scss',
})
export class MembersPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly searchTerm = signal('');
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
    this.loadMembers();
  }

  protected loadMembers() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http
      .get<MemberSummary[]>(`${getApiBaseUrl()}/members`, {
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