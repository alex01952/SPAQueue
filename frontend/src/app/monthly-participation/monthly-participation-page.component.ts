import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

interface MonthlyParticipationPlayer {
  name: string;
  count: number;
}

interface MonthlyParticipationSummary {
  month: string;
  players: MonthlyParticipationPlayer[];
}

@Component({
  selector: 'app-monthly-participation-page',
  imports: [],
  templateUrl: './monthly-participation-page.component.html',
  styleUrl: './monthly-participation-page.component.scss',
})
export class MonthlyParticipationPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = 'http://localhost:3000';

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly playerFilter = signal('');
  protected readonly selectedMonth = signal('all');
  protected readonly summaries = signal<MonthlyParticipationSummary[]>([]);
  protected readonly monthOptions = computed(() => this.summaries().map((summary) => summary.month));
  protected readonly filteredSummaries = computed(() => {
    const filter = this.playerFilter().trim().toLowerCase();
    const month = this.selectedMonth();

    const monthFilteredSummaries = month === 'all'
      ? this.summaries()
      : this.summaries().filter((summary) => summary.month === month);

    if (!filter) {
      return monthFilteredSummaries;
    }

    return monthFilteredSummaries
      .map((summary) => ({
        ...summary,
        players: summary.players.filter((player) => player.name.toLowerCase().includes(filter)),
      }))
      .filter((summary) => summary.players.length > 0);
  });
  protected readonly monthCount = computed(() => this.summaries().length);
  protected readonly uniquePlayerCount = computed(
    () => new Set(this.summaries().flatMap((summary) => summary.players.map((player) => player.name))).size,
  );
  protected readonly participationCount = computed(
    () => this.summaries().flatMap((summary) => summary.players).reduce((total, player) => total + player.count, 0),
  );

  ngOnInit() {
    this.loadSummaries();
  }

  protected loadSummaries() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http.get<MonthlyParticipationSummary[]>(`${this.apiBaseUrl}/participation/monthly`).subscribe({
      next: (response) => {
        this.summaries.set(response);

        const currentSelectedMonth = this.selectedMonth();
        if (currentSelectedMonth !== 'all' && !response.some((summary) => summary.month === currentSelectedMonth)) {
          this.selectedMonth.set('all');
        }

        this.isLoading.set(false);
      },
      error: (error) => {
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

  protected getMonthParticipationTotal(summary: MonthlyParticipationSummary) {
    return summary.players.reduce((total, player) => total + player.count, 0);
  }
}