import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import { AuthenticatedMember, MemberAuthService } from '../member-auth.service';
import { calculatePlayerRpgStats } from './player-rpg-stats';

interface MemberSkill {
  name: string;
  rating: number;
}

@Component({
  selector: 'app-member-profile-page',
  imports: [RouterLink],
  templateUrl: './member-profile-page.component.html',
  styleUrl: './member-profile-page.component.scss',
})
export class MemberProfilePageComponent implements OnInit {
  private readonly auth = inject(MemberAuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly member = signal<AuthenticatedMember | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');
  private readonly selectedMemberId = signal<string | null>(null);
  protected readonly isOwnProfile = computed(() => !this.selectedMemberId());
  protected readonly skills = computed<MemberSkill[]>(() =>
    Object.entries(this.member()?.skills ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([name, rating]) => ({
        name: name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/^./, (letter) => letter.toUpperCase()),
        rating,
      })),
  );
  protected readonly memberSince = computed(() => {
    const createdAt = this.member()?.createdAt;
    const date = createdAt ? new Date(createdAt) : null;

    return date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(date)
      : 'Not available';
  });
  protected readonly initials = computed(() =>
    (this.member()?.name ?? 'Member')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(''),
  );

  protected readonly averageSkill = computed(() => {
    const skills = this.skills();

    if (!skills.length) {
      return '0.0';
    }

    const total = skills.reduce((sum, skill) => sum + skill.rating, 0);

    return (total / skills.length).toFixed(1);
  });
  protected readonly rpgStats = computed(() =>
    calculatePlayerRpgStats(this.member()?.skills),
  );

  ngOnInit() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const memberId = params.get('memberId');
        this.selectedMemberId.set(memberId);

        if (memberId) {
          this.loadMemberProfile(memberId);
          return;
        }

        this.member.set(this.auth.member());
        this.errorMessage.set('');
        this.isLoading.set(false);
      });
  }

  protected retryLoadingProfile() {
    const memberId = this.selectedMemberId();
    if (memberId) {
      this.loadMemberProfile(memberId);
    }
  }

  private loadMemberProfile(memberId: string) {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.member.set(null);

    this.http
      .get<AuthenticatedMember>(
        `${getApiBaseUrl()}/members/${encodeURIComponent(memberId)}`,
        { withCredentials: true },
      )
      .subscribe({
        next: (member) => {
          this.member.set(member);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            error.status === 404
              ? 'This member profile could not be found.'
              : 'Unable to load this member profile. Please try again.',
          );
        },
      });
  }

  protected publicDetail(value: string | number | null) {
    return value === null || value === '' ? 'Not provided' : String(value);
  }

  protected skillProgress(rating: number) {
    return Math.min(Math.max(rating, 0), 10) * 10;
  }
}