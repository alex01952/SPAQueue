import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, expand, reduce } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { StaffRedemption, StaffRedemptionHistory } from './rewards.models';

@Component({
  selector: 'app-redemptions-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './redemptions-page.component.html',
  styleUrl: './rewards.scss',
})
export class RedemptionsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  protected from = this.today;
  protected to = this.today;
  protected status = 'all';
  protected readonly records = signal<StaffRedemption[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly loaded = signal(false);

  ngOnInit() { this.load(); }

  protected load() {
    if (this.loading() || this.saving()) return;
    if (!this.from || !this.to || this.from > this.to) {
      this.error.set('Enter a valid from and to date in order.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.loaded.set(false);
    this.records.set([]);
    const params = { from: this.from, to: this.to, status: this.status };
    const fetchPage = (continuation?: string) =>
      this.http.get<StaffRedemptionHistory>(`${getApiBaseUrl()}/redemptions`, {
        withCredentials: true,
        params: continuation ? { ...params, continuation } : params,
      });
    fetchPage().pipe(
      expand((page) => page.continuationToken ? fetchPage(page.continuationToken) : EMPTY),
      reduce((records, page) => [...records, ...page.records], [] as StaffRedemption[]),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (records) => {
        this.records.set(records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.apiError(error, 'Unable to load redemptions.'));
        this.loading.set(false);
      },
    });
  }

  protected markUsed(record: StaffRedemption) {
    if (this.loading() || this.saving() || record.used) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.http.post<{ used: boolean }>(
      `${getApiBaseUrl()}/redemptions/${encodeURIComponent(record.memberId)}/${encodeURIComponent(record.transactionId)}/used`,
      {}, { withCredentials: true },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set('Redemption marked as used.');
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.apiError(error, 'Unable to mark the redemption as used. Refresh before retrying.'));
      },
    });
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return typeof error.error?.message === 'string' ? error.error.message : fallback;
  }
}
