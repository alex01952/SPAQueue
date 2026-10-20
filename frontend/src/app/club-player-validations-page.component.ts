import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { getApiBaseUrl } from './api-base-url';
import { MemberAuthService } from './member-auth.service';
import { MemberProfileFrameComponent } from './member-profile/member-profile-frame.component';

interface Club {
  clubId: string;
  name: string;
}

interface PlayerProfileValidation {
  officerName: string;
  clubName: string;
  validatedAt: string;
}

interface ClubMember {
  memberId: string;
  name: string;
  profileImageUrl: string;
  location?: string;
  validations: PlayerProfileValidation[];
}

@Component({
  selector: 'app-club-player-validations-page',
  imports: [DatePipe, MemberProfileFrameComponent],
  templateUrl: './club-player-validations-page.component.html',
  styleUrl: './club-player-validations-page.component.scss',
})
export class ClubPlayerValidationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(MemberAuthService);
  private readonly apiUrl = getApiBaseUrl();

  protected readonly clubs = signal<Club[]>([]);
  protected readonly selectedClubId = signal('');
  protected readonly members = signal<ClubMember[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly validatingMemberId = signal('');
  protected readonly profileMember = signal<ClubMember | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');

  ngOnInit() {
    this.http
      .get<Club[]>(`${this.apiUrl}/clubs/me/officer-memberships`, {
        withCredentials: true,
      })
      .subscribe({
        next: (clubs) => {
          this.clubs.set(clubs);
          this.isLoading.set(false);
          if (clubs.length) {
            this.selectClub(clubs[0].clubId);
          }
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Unable to load your officer clubs.',
          );
          this.isLoading.set(false);
        },
      });
  }

  protected selectClub(clubId: string) {
    this.selectedClubId.set(clubId);
    this.members.set([]);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    if (!clubId) return;

    this.loadMembers(clubId);
  }

  private loadMembers(clubId: string) {
    this.isLoading.set(true);
    this.http
      .get<ClubMember[]>(
        `${this.apiUrl}/clubs/${encodeURIComponent(clubId)}/members/profile-validations`,
        { withCredentials: true },
      )
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Unable to load club members.',
          );
          this.isLoading.set(false);
        },
      });
  }

  protected validate(member: ClubMember) {
    const clubId = this.selectedClubId();
    if (!clubId || this.validatingMemberId()) return;

    this.validatingMemberId.set(member.memberId);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http
      .post<PlayerProfileValidation>(
        `${this.apiUrl}/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(member.memberId)}/profile-validations`,
        {},
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.feedbackMessage.set(`${member.name}'s profile and stats were validated.`);
          this.validatingMemberId.set('');
          this.loadMembers(clubId);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Unable to validate this player profile.',
          );
          this.validatingMemberId.set('');
        },
      });
  }

  protected canValidate(member: ClubMember) {
    return member.memberId !== this.auth.member()?.memberId;
  }

  protected showProfile(member: ClubMember) {
    this.profileMember.set(member);
  }

  protected closeProfile() {
    this.profileMember.set(null);
  }
}
