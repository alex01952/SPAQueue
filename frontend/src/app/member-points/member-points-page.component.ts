import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { isGoldMembershipActive } from '../gold-membership';

type PointSource = 'OpenPlayParticipation' | 'CourtRental' | 'CustomAward';
interface PointMember {
  memberId: string;
  name: string;
  goldMembershipExpiresOn?: string | null;
}
interface PointAward {
  awardId: string;
  source: PointSource;
  activityDate: string;
  points: number;
  scheduleName: string;
  startHour: number | null;
  courtNumber: number | null;
  reason: string;
  createdByName: string;
  createdAt: string;
}
interface History {
  balance: number;
  awards: PointAward[];
  continuationToken: string | null;
}

@Component({
  selector: 'app-member-points-page',
  imports: [FormsModule, DatePipe],
  templateUrl: './member-points-page.component.html',
  styleUrl: './member-points-page.component.scss',
})
export class MemberPointsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly members = signal<PointMember[]>([]);
  protected readonly search = signal('');
  protected readonly selected = signal<PointMember | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadingHistory = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly historyError = signal('');
  protected readonly message = signal('');
  protected readonly history = signal<History | null>(null);
  protected readonly config = signal<{ openPlayPoints: number | null; courtRentalPoints: number | null } | null>(null);
  protected readonly isGoldMembershipActive = isGoldMembershipActive;
  protected readonly filteredMembers = computed(() => this.members().filter((member) =>
    member.name.toLowerCase().includes(this.search().trim().toLowerCase())));
  protected readonly slots = Array.from({ length: 24 }, (_, hour) => ({ hour, label: this.slotLabel(hour) }));
  protected readonly sources: Record<PointSource, string> = {
    OpenPlayParticipation: 'Open Play Participation', CourtRental: 'Court Rental', CustomAward: 'Custom Award',
  };
  protected form = this.emptyForm();
  private pendingRequest: { fingerprint: string; requestId: string } | null = null;
  private historyVersion = 0;

  protected get today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  ngOnInit() { this.load(); }

  private emptyForm() {
    return {
      source: 'OpenPlayParticipation' as PointSource,
      activityDate: this.today, scheduleName: '', startHour: 16,
      courtNumber: 1, points: null as number | null, reason: '',
    };
  }

  protected slotLabel(hour: number) {
    const label = (value: number) => `${value % 12 || 12}${value < 12 ? 'AM' : 'PM'}`;
    return `${label(hour)} - ${label((hour + 1) % 24)}${hour === 23 ? ' (next day)' : ''}`;
  }

  protected load() {
    if (this.loading() || this.saving()) return;
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      members: this.http.get<PointMember[]>(`${getApiBaseUrl()}/members`, { withCredentials: true }),
      config: this.http.get<{ openPlayPoints: number | null; courtRentalPoints: number | null }>(
        `${getApiBaseUrl()}/member-points/config`, { withCredentials: true }),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ members, config }) => {
        this.members.set(members);
        this.config.set(config);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.apiError(error, 'Unable to load members and point settings.'));
        this.loading.set(false);
      },
    });
  }

  protected selectMember(memberId: string) {
    if (this.saving()) return;
    if (this.pendingRequest) {
      this.error.set('Retry the unconfirmed award with its original details before changing members, or check history before reloading this page.');
      return;
    }
    this.historyVersion++;
    this.selected.set(this.members().find((member) => member.memberId === memberId) ?? null);
    this.history.set(null);
    this.loadingHistory.set(false);
    this.historyError.set('');
    this.error.set('');
    this.message.set('');
    this.form = this.emptyForm();
    this.pendingRequest = null;
    if (this.selected()) this.loadHistory();
  }

  protected loadHistory(more = false) {
    const member = this.selected();
    if (!member || this.loadingHistory()) return;
    const continuation = more ? this.history()?.continuationToken : null;
    if (more && !continuation) return;
    this.loadingHistory.set(true);
    const version = ++this.historyVersion;
    this.historyError.set('');
    this.http.get<History>(
      `${getApiBaseUrl()}/member-points/${encodeURIComponent(member.memberId)}`,
      { withCredentials: true, params: continuation ? { continuation } : {} },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (history) => {
        if (version !== this.historyVersion) return;
        this.history.set({
          ...history,
          awards: more ? [...(this.history()?.awards ?? []), ...history.awards] : history.awards,
        });
        this.loadingHistory.set(false);
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.historyVersion) return;
        this.historyError.set(this.apiError(error, 'Unable to load points history.'));
        this.loadingHistory.set(false);
      },
    });
  }

  protected save() {
    const member = this.selected();
    if (!member || this.saving() || this.loadingHistory()) return;
    this.error.set('');
    this.message.set('');
    if (!isGoldMembershipActive(member.goldMembershipExpiresOn)) {
      this.error.set('Only members with an active Gold membership can receive points.');
      return;
    }
    const payload = {
      source: this.form.source, activityDate: this.form.activityDate,
      ...(this.form.source === 'OpenPlayParticipation' ? { scheduleName: this.form.scheduleName } : {}),
      ...(this.form.source === 'CourtRental' ? { startHour: this.form.startHour, courtNumber: this.form.courtNumber } : {}),
      ...(this.form.source === 'CustomAward' ? { points: this.form.points, reason: this.form.reason } : {}),
    };
    const fingerprint = JSON.stringify({ memberId: member.memberId, ...payload });
    if (this.pendingRequest && this.pendingRequest.fingerprint !== fingerprint) {
      this.error.set('A previous award is unconfirmed. Restore its original details and retry it, or check history before reloading this page to start another award.');
      return;
    }
    this.pendingRequest ??= { fingerprint, requestId: crypto.randomUUID() };
    this.saving.set(true);
    this.http.post<PointAward>(
      `${getApiBaseUrl()}/member-points/${encodeURIComponent(member.memberId)}`,
      { ...payload, requestId: this.pendingRequest.requestId }, { withCredentials: true },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (award) => {
        this.saving.set(false);
        this.pendingRequest = null;
        this.message.set(`${award.points} points awarded. Activity recorded in history.`);
        this.form = this.emptyForm();
        this.loadHistory();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        const uncertain = error.status === 0 || error.status >= 500;
        if (!uncertain) this.pendingRequest = null;
        this.error.set(this.apiError(error, 'Unable to award points.') +
          (uncertain ? ' The award may have been recorded. Retry with unchanged details; the same request ID prevents a duplicate. Check history before starting another award.' : ''));
      },
    });
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return typeof error.error?.message === 'string' ? error.error.message : fallback;
  }
}
