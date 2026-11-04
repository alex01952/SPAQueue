import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { concatMap, from, toArray } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { downloadTournamentCsv } from './tournament-csv';
import type { TournamentPrintingPlayer, TournamentPrintingPlayerRef, TournamentPrintingState } from './tournament.types';

type PrintingFilter = 'All' | 'Not exported' | 'Exported';

@Component({
  selector: 'app-tournament-printing-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './tournament-printing-page.component.html',
  styleUrl: './tournament-registrations-page.component.scss',
})
export class TournamentPrintingPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
  private readonly url = `${getApiBaseUrl()}/admin/tournaments/${encodeURIComponent(this.tournamentId)}`;
  protected readonly state = signal<TournamentPrintingState | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly feedback = signal('');
  protected readonly filter = signal<PrintingFilter>('All');
  protected readonly filters: PrintingFilter[] = ['All', 'Not exported', 'Exported'];
  protected readonly untaggedPlayers = computed(() =>
    this.state()?.players.filter((player) => !player.exportedForPrinting) ?? [],
  );
  protected readonly visiblePlayers = computed(() => {
    const filter = this.filter();
    return this.state()?.players.filter((player) =>
      filter === 'All' || player.exportedForPrinting === (filter === 'Exported'),
    ) ?? [];
  });

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    if (this.busy()) return;
    this.error.set('');
    this.feedback.set('');
    this.busy.set(true);
    this.refresh();
  }

  protected tagPlayer(player: TournamentPrintingPlayer) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.feedback.set('');
    this.saveTags([player], !player.exportedForPrinting, false);
  }

  protected exportPlayers() {
    if (this.busy() || !this.state() || !this.untaggedPlayers().length) return;
    this.busy.set(true);
    this.error.set('');
    this.feedback.set('');
    this.http.get<TournamentPrintingState>(`${this.url}/printing-players`, { withCredentials: true }).subscribe({
      next: (state) => {
        this.state.set(state);
        const players = state.players.filter((player) => !player.exportedForPrinting);
        if (!players.length) {
          this.feedback.set('No untagged players remain to export.');
          this.busy.set(false);
          return;
        }
        try {
          downloadTournamentCsv([
            ['Tournament ID', 'Tournament name', 'Registration ID', 'Player ID', 'Player name', 'T-shirt size', 'Registration status'],
            ...players.map((player) => [
              state.tournament.tournamentId, state.tournament.name, player.registrationId,
              player.memberId, player.name, player.tshirtSize ?? '', player.status,
            ]),
          ], `tournament-${this.tournamentId}-tshirt-printing-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        } catch (error) {
          console.error('Tournament printing CSV download failed.', error);
          this.error.set('Unable to start the printing CSV download. No players were tagged.');
          this.busy.set(false);
          return;
        }
        this.saveTags(players, true, true);
      },
      error: (error: HttpErrorResponse) => {
        this.state.set(null);
        this.error.set(this.errorText(error, 'Unable to load current players for export. No download or tagging was started.'));
        this.busy.set(false);
      },
    });
  }

  private saveTags(players: TournamentPrintingPlayer[], exportedForPrinting: boolean, afterExport: boolean) {
    const registrations = new Map<string, TournamentPrintingPlayerRef[]>();
    for (const { registrationId, memberId, version } of players) {
      const group = registrations.get(registrationId) ?? [];
      group.push({ registrationId, memberId, version });
      registrations.set(registrationId, group);
    }
    const groups = [...registrations.values()];
    const batches: TournamentPrintingPlayerRef[][] = [];
    // Bound request sizes while keeping teammates together to consume each registration version once.
    for (let index = 0; index < groups.length; index += 50) {
      batches.push(groups.slice(index, index + 50).flat());
    }
    from(batches).pipe(
      concatMap((batch) => this.http.patch<{ updated: true }>(`${this.url}/printing-tags`, {
        exportedForPrinting, players: batch,
      }, { withCredentials: true })),
      toArray(),
    ).subscribe({
      next: () => {
        this.feedback.set(afterExport
          ? `CSV download started for ${players.length} players. These players are now tagged as exported for printing. If the file was not saved, untag them to export again.`
          : exportedForPrinting ? 'Player tagged as exported for printing.' : 'Player untagged and will be included in the next export.');
        this.refresh();
      },
      error: (error: HttpErrorResponse) => {
        const detail = this.errorText(error, 'Unable to save printing tags.');
        this.error.set(afterExport
          ? `CSV download started, but printing tags could not be fully saved. Some players may already be tagged. Review the refreshed list before exporting again. ${detail}`
          : detail);
        this.refresh();
      },
    });
  }

  private refresh() {
    this.state.set(null);
    this.http.get<TournamentPrintingState>(`${this.url}/printing-players`, { withCredentials: true }).subscribe({
      next: (state) => {
        this.state.set(state);
        this.busy.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.error.update((message) => [message, this.errorText(error, 'Unable to reload the printing list. Please reload before continuing.')].filter(Boolean).join(' '));
        this.busy.set(false);
      },
    });
  }

  private errorText(error: HttpErrorResponse, fallback: string): string {
    const message = error.error?.message;
    return Array.isArray(message) ? message.join(' ') : message || fallback;
  }
}
