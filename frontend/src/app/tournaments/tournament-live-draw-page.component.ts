import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, timeout, TimeoutError } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import type { TournamentLiveDrawState } from './tournament.types';

@Component({
  selector: 'app-tournament-live-draw-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './tournament-live-draw-page.component.html',
  styleUrl: './tournament-live-draw-page.component.scss',
})
export class TournamentLiveDrawPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
  private readonly url = `${getApiBaseUrl()}/tournaments/${encodeURIComponent(this.tournamentId)}/live-draw`;
  private readonly requests = new Subscription();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private clockTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  protected readonly refreshing = signal(false);
  private offset = 0;
  protected readonly state = signal<TournamentLiveDrawState | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly busy = signal(false);
  protected readonly connected = signal(false);
  protected readonly error = signal('');
  protected readonly feedback = signal('');
  protected scheduledAt = '';
  protected poolCount = 1;
  protected rosterFinalized = false;
  protected readonly remaining = computed(() => {
    const endsAt = this.state()?.event?.phaseEndsAt;
    return endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - this.now()) / 1000)) : 0;
  });
  protected readonly countdown = computed(() => {
    const total = this.remaining();
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total / 3600) % 24;
    const minutes = Math.floor(total / 60) % 60;
    const seconds = total % 60;
    return `${days ? days + 'd ' : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });
  protected readonly canSchedule = computed(() => {
    const phase = this.state()?.event?.phase;
    return this.state()?.canManage && (!phase || ['scheduled', 'invalidated', 'final'].includes(phase));
  });

  ngOnInit() {
    this.refresh();
    this.clockTimer = setInterval(() => this.now.set(Date.now() + this.offset), 250);
  }

  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.pollTimer);
    clearInterval(this.clockTimer);
    this.requests.unsubscribe();
  }

  protected refresh() {
    if (this.refreshing() || this.busy() || this.destroyed) return;
    clearTimeout(this.pollTimer);
    this.refreshing.set(true);
    const sentAt = Date.now();
    this.requests.add(this.http.post<TournamentLiveDrawState>(
      `${this.url}/presence`, {}, { withCredentials: true },
    ).pipe(timeout(30_000)).subscribe({
      next: (state) => {
        this.applyState(state, sentAt);
        this.error.set('');
        this.refreshing.set(false);
        this.queuePoll();
      },
      error: (error: unknown) => {
        this.handleError(error);
        this.refreshing.set(false);
        // Reconnects automatically without pretending stale data is live.
        if (!(error instanceof HttpErrorResponse) || ![401, 403, 404].includes(error.status)) this.queuePoll();
      },
    }));
  }

  protected schedule() {
    if (this.busy() || this.refreshing() || !this.connected() || !this.canSchedule()) return;
    const timestamp = new Date(this.scheduledAt).getTime();
    if (!this.rosterFinalized || !Number.isFinite(timestamp) || timestamp < this.now() + 60_000 ||
        !Number.isSafeInteger(this.poolCount) || this.poolCount < 1 ||
        this.poolCount > Math.floor((this.state()?.roster.teams.length ?? 0) / 2)) {
      this.error.set('Confirm the finalized roster, choose a valid pool count, and a start time at least one minute ahead.');
      return;
    }
    if (!window.confirm('Schedule this live draw using the finalized roster? Any saved pools and match schedule will be cleared. Everyone must join before the countdown ends to be eligible to vote.')) return;
    this.send(`${getApiBaseUrl()}/admin/tournaments/${encodeURIComponent(this.tournamentId)}/live-draw`, {
      scheduledAt: new Date(timestamp).toISOString(), poolCount: this.poolCount,
      rosterFinalized: true, expectedEventId: this.state()?.event?.eventId ?? null,
    }, 'Live draw scheduled. Share this page with the confirmed participants.');
  }

  protected vote() {
    if (this.busy() || this.refreshing() || !this.connected() || !this.state()?.event?.canVote || this.remaining() === 0) return;
    this.send(`${this.url}/vote`, { eventId: this.state()?.event?.eventId }, 'Your one reroll vote has been recorded.');
  }

  protected teamLabel(id: string) {
    return this.state()?.roster.teams.find((team) => team.registrationId === id)?.players
      .map((player) => player.name).join(' + ') ?? id;
  }

  private send(url: string, body: object, message: string) {
    clearTimeout(this.pollTimer);
    this.busy.set(true);
    this.error.set('');
    this.feedback.set('');
    const sentAt = Date.now();
    this.requests.add(this.http.post<TournamentLiveDrawState>(url, body, { withCredentials: true }).pipe(timeout(30_000)).subscribe({
      next: (state) => {
        this.applyState(state, sentAt);
        this.feedback.set(message);
        this.busy.set(false);
        this.queuePoll();
      },
      error: (error: unknown) => {
        this.handleError(error);
        this.busy.set(false);
        this.queuePoll();
      },
    }));
  }

  private applyState(state: TournamentLiveDrawState, sentAt: number) {
    this.offset = Date.parse(state.serverNow) - (sentAt + Date.now()) / 2;
    this.now.set(Date.now() + this.offset);
    this.state.set(state);
    this.connected.set(true);
    if (state.event?.hasVoted) this.feedback.set('Your one reroll vote has been recorded.');
  }

  private handleError(error: unknown) {
    this.connected.set(false);
    if (error instanceof TimeoutError) {
      this.error.set('The live draw API did not respond within 30 seconds. Retrying automatically. A submitted schedule or vote may still have been saved; wait for reconnection to confirm.');
    } else if (error instanceof HttpErrorResponse) {
      const message: unknown = error.error?.message;
      if (typeof message === 'string') {
        this.error.set(`Live draw request failed (HTTP ${error.status}): ${message}`);
      } else if (error.status === 0) {
        this.error.set('Cannot reach the live draw API. Check your connection and that the API is running. Retrying automatically.');
      } else {
        this.error.set(`Live draw request failed (HTTP ${error.status}). Use Reconnect / refresh to retry.`);
      }
    } else {
      this.error.set('An unexpected live draw request error occurred. Use Reconnect / refresh to retry.');
    }
  }

  private queuePoll() {
    if (this.destroyed) return;
    const endsAt = this.state()?.event?.phaseEndsAt;
    const untilBoundary = endsAt ? Date.parse(endsAt) - (Date.now() + this.offset) + 100 : Infinity;
    const delay = Math.max(250, Math.min(3000 + Math.random() * 1000, untilBoundary));
    this.pollTimer = setTimeout(() => this.refresh(), delay);
  }
}
