import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { getApiBaseUrl } from '../api-base-url';

interface MonthlyParticipationPlayer {
  name: string;
  count: number;
}

interface MonthlyParticipationSummary {
  month: string;
  players: MonthlyParticipationPlayer[];
}

interface MonthlyParticipationSummaryResponse {
  arenaMasterEligibilityCount: number | null;
  lastUpdatedAt: string | null;
  summaries: MonthlyParticipationSummary[];
}

@Component({
  selector: 'app-monthly-participation-page',
  imports: [],
  templateUrl: './monthly-participation-page.component.html',
  styleUrl: './monthly-participation-page.component.scss',
})
export class MonthlyParticipationPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = getApiBaseUrl();

  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/Logo.png';
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly playerFilter = signal('');
  protected readonly selectedMonth = signal('all');
  protected readonly showArenaMasterEligibleOnly = signal(false);
  protected readonly arenaMasterEligibilityCount = signal<number | null>(null);
  protected readonly lastUpdatedAt = signal<string | null>(null);
  protected readonly summaries = signal<MonthlyParticipationSummary[]>([]);
  protected readonly lastUpdatedLabel = computed(() => {
    const lastUpdatedAt = this.lastUpdatedAt();

    if (!lastUpdatedAt) {
      return '';
    }

    const parsed = new Date(lastUpdatedAt);

    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(parsed);
  });
  protected readonly monthOptions = computed(() =>
    this.summaries().map((summary) => summary.month),
  );
  protected readonly filteredSummaries = computed(() => {
    const filter = this.playerFilter().trim().toLowerCase();
    const month = this.selectedMonth();
    const showEligibleOnly = this.showArenaMasterEligibleOnly();
    const eligibilityCount = this.arenaMasterEligibilityCount();

    const monthFilteredSummaries =
      month === 'all'
        ? this.summaries()
        : this.summaries().filter((summary) => summary.month === month);

    return monthFilteredSummaries
      .map((summary) => ({
        ...summary,
        players: summary.players.filter((player) => {
          const matchesName = !filter || player.name.toLowerCase().includes(filter);
          const matchesEligibility =
            !showEligibleOnly || eligibilityCount === null || player.count >= eligibilityCount;

          return matchesName && matchesEligibility;
        }),
      }))
      .filter((summary) => summary.players.length > 0);
  });
  protected readonly monthCount = computed(() => this.summaries().length);
  protected readonly uniquePlayerCount = computed(
    () =>
      new Set(this.summaries().flatMap((summary) => summary.players.map((player) => player.name)))
        .size,
  );
  protected readonly participationCount = computed(() =>
    this.summaries()
      .flatMap((summary) => summary.players)
      .reduce((total, player) => total + player.count, 0),
  );

  ngOnInit() {
    this.loadSummaries();
  }

  protected loadSummaries() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http
      .get<MonthlyParticipationSummaryResponse>(`${this.apiBaseUrl}/participation/monthly`)
      .subscribe({
        next: (response) => {
          this.arenaMasterEligibilityCount.set(response.arenaMasterEligibilityCount);
          this.lastUpdatedAt.set(response.lastUpdatedAt);
          this.summaries.set(response.summaries);

          if (response.arenaMasterEligibilityCount === null) {
            this.showArenaMasterEligibleOnly.set(false);
          }

          const currentSelectedMonth = this.selectedMonth();
          if (
            currentSelectedMonth !== 'all' &&
            !response.summaries.some((summary) => summary.month === currentSelectedMonth)
          ) {
            this.selectedMonth.set('all');
          }

          this.isLoading.set(false);
        },
        error: (error) => {
          this.arenaMasterEligibilityCount.set(null);
          this.showArenaMasterEligibleOnly.set(false);
          this.lastUpdatedAt.set(null);
          this.summaries.set([]);
          this.selectedMonth.set('all');
          this.isLoading.set(false);
          this.errorMessage.set(
            error?.error?.message || 'Unable to load the monthly participation summary.',
          );
        },
      });
  }

  protected updatePlayerFilter(value: string) {
    this.playerFilter.set(value);
  }

  protected updateSelectedMonth(value: string) {
    this.selectedMonth.set(value);
  }

  protected updateShowArenaMasterEligibleOnly(value: boolean) {
    this.showArenaMasterEligibleOnly.set(value);
  }

  protected getMonthParticipationTotal(summary: MonthlyParticipationSummary) {
    return summary.players.reduce((total, player) => total + player.count, 0);
  }

  protected getDisplayParticipationCount(count: number) {
    const eligibilityCount = this.arenaMasterEligibilityCount();

    if (eligibilityCount === null || count <= eligibilityCount) {
      return `${count}`;
    }

    return `${eligibilityCount}+`;
  }
}
