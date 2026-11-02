import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { HistoryKind, RewardHistory, RewardRecord, StoreItem, Wallet } from './rewards.models';

interface PendingTransaction {
  memberId: string;
  kind: 'convert' | 'redeem';
  requestId: string;
  points?: number;
  itemId?: string;
  version?: string;
}

@Component({
  selector: 'app-my-rewards-page',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './my-rewards-page.component.html',
  styleUrl: './rewards.scss',
})
export class MyRewardsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly wallet = signal<Wallet | null>(null);
  protected readonly items = signal<StoreItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly history = signal<RewardHistory | null>(null);
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  protected readonly pending = signal<PendingTransaction | null>(null);
  protected readonly recoveryBlocked = signal(false);
  protected readonly recoveryMessage = signal('');
  protected readonly kind = signal<HistoryKind>('award');
  protected readonly selectedItem = signal<StoreItem | null>(null);
  protected points: number | null = null;
  private historyVersion = 0;
  private readonly storagePrefix = 'spaqueue-rewards-request:';
  protected readonly sourceLabels: Record<string, string> = {
    OpenPlayParticipation: 'Open Play Participation', CourtRental: 'Court Rental', CustomAward: 'Custom Award',
  };

  ngOnInit() { this.load(); }

  protected load() {
    if (this.loading() || this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      wallet: this.http.get<Wallet>(`${getApiBaseUrl()}/my-rewards`, { withCredentials: true }),
      items: this.http.get<StoreItem[]>(`${getApiBaseUrl()}/store`, { withCredentials: true }),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ wallet, items }) => {
        this.wallet.set(wallet);
        this.items.set(items);
        this.loading.set(false);
        this.restorePending(wallet.memberId);
        this.loadHistory();
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.apiError(error, 'Unable to load your rewards.'));
        this.loading.set(false);
      },
    });
  }

  private restorePending(memberId: string) {
    try {
      const saved = sessionStorage.getItem(this.storagePrefix + memberId);
      if (!saved) { this.pending.set(null); return; }
      const data: unknown = JSON.parse(saved);
      if (!data || typeof data !== 'object' ||
        !('memberId' in data) || data.memberId !== memberId ||
        !('requestId' in data) || typeof data.requestId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.requestId) ||
        !('kind' in data) || !['convert', 'redeem'].includes(String(data.kind))) {
        throw new Error('Invalid saved transaction.');
      }
      if (data.kind === 'convert' && 'points' in data &&
        typeof data.points === 'number' && Number.isSafeInteger(data.points) && data.points > 0) {
        this.pending.set({ memberId, requestId: data.requestId, kind: 'convert', points: data.points });
      } else if (data.kind === 'redeem' && 'itemId' in data && typeof data.itemId === 'string' &&
        'version' in data && typeof data.version === 'string') {
        this.pending.set({ memberId, requestId: data.requestId, kind: 'redeem', itemId: data.itemId, version: data.version });
      } else {
        throw new Error('Invalid saved transaction details.');
      }
      this.recoveryBlocked.set(false);
    } catch {
      this.error.set('Unable to recover saved transaction details. Check your history before starting another transaction.');
      this.recoveryBlocked.set(true);
    }
  }

  protected selectKind(kind: HistoryKind) {
    this.kind.set(kind);
    this.history.set(null);
    this.loadHistory();
  }

  protected loadHistory(more = false) {
    const continuation = more ? this.history()?.continuationToken : null;
    if (more && !continuation) return;
    const version = ++this.historyVersion;
    this.historyLoading.set(true);
    this.historyError.set('');
    this.http.get<RewardHistory>(`${getApiBaseUrl()}/my-rewards/history`, {
      withCredentials: true,
      params: { kind: this.kind(), ...(continuation ? { continuation } : {}) },
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (history) => {
        if (version !== this.historyVersion) return;
        this.history.set({
          ...history, records: more ? [...(this.history()?.records ?? []), ...history.records] : history.records,
        });
        this.historyLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.historyVersion) return;
        this.historyError.set(this.apiError(error, 'Unable to load rewards history.'));
        this.historyLoading.set(false);
      },
    });
  }

  protected convert() {
    const wallet = this.wallet();
    if (!wallet?.activeGold || this.pending() || this.busy() || this.recoveryBlocked()) return;
    if (!this.points || !Number.isSafeInteger(this.points) || this.points < 1 || this.points > wallet.points) {
      this.error.set('Enter a positive whole-number amount within your available points.');
      return;
    }
    this.start({ memberId: wallet.memberId, requestId: crypto.randomUUID(), kind: 'convert', points: this.points });
  }

  protected confirmRedemption() {
    const wallet = this.wallet();
    const item = this.selectedItem();
    if (!wallet?.activeGold || !item || this.pending() || this.busy() || this.recoveryBlocked()) return;
    this.selectedItem.set(null);
    this.start({
      memberId: wallet.memberId, requestId: crypto.randomUUID(),
      kind: 'redeem', itemId: item.itemId, version: item.version,
    });
  }

  private start(transaction: PendingTransaction) {
    try {
      sessionStorage.setItem(this.storagePrefix + transaction.memberId, JSON.stringify(transaction));
    } catch {
      this.error.set('Cannot save a recovery request in this browser. Enable session storage before continuing. Nothing was submitted.');
      return;
    }
    this.pending.set(transaction);
    this.retry();
  }

  protected retry() {
    const pending = this.pending();
    if (!pending || this.busy() || this.loading()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    this.http.post<RewardRecord>(
      `${getApiBaseUrl()}/my-rewards/${pending.kind}`, pending, { withCredentials: true },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.clearPending();
        this.points = null;
        this.message.set(pending.kind === 'convert'
          ? `${result.points} points converted into ${result.tokens} tokens.`
          : `Redeemed ${result.itemName} for ${result.tokens} tokens. Reference: ${result.transactionId}. Member email: ${result.memberEmailStatus}; merchant email: ${result.merchantEmailStatus}.`);
        this.kind.set(pending.kind === 'convert' ? 'conversion' : 'redemption');
        this.historyVersion++;
        this.history.set(null);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        const uncertain = error.status === 0 || error.status >= 500 || error.status === 409;
        if (!uncertain) this.clearPending();
        this.error.set(this.apiError(error, 'Unable to complete the transaction.') +
          (uncertain ? ' The result may be unconfirmed. Retry the saved request; it cannot spend twice. Check history before starting a new request.' : ''));
      },
    });
  }

  private clearPending() {
    const transaction = this.pending();
    if (transaction) {
      try {
        sessionStorage.removeItem(this.storagePrefix + transaction.memberId);
        this.recoveryMessage.set('');
      } catch {
        this.recoveryMessage.set('Browser recovery data could not be removed. Reloading may safely replay the saved request; check history before starting another transaction.');
      }
    }
    this.pending.set(null);
  }

  protected abandonPending() {
    if (this.busy()) return;
    if (this.recoveryBlocked()) {
      try {
        const wallet = this.wallet();
        if (!wallet) return;
        sessionStorage.removeItem(this.storagePrefix + wallet.memberId);
        this.recoveryBlocked.set(false);
      } catch {
        this.error.set('Cannot clear recovery data. Enable session storage and reload this page.');
        return;
      }
    }
    this.clearPending();
    this.message.set('Saved retry cleared. Verify your history before submitting a new transaction.');
    this.load();
  }

  protected retryEmail(record: RewardRecord) {
    if (this.busy() || !record.transactionId) return;
    this.busy.set(true);
    this.error.set('');
    this.http.post<RewardRecord>(
      `${getApiBaseUrl()}/my-rewards/redemptions/${encodeURIComponent(record.transactionId)}/email`,
      { confirmResend: true }, { withCredentials: true },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.message.set(`Member email: ${result.memberEmailStatus}; merchant email: ${result.merchantEmailStatus}. No additional tokens were spent.`);
        this.loadHistory();
      },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(this.apiError(error, 'Email delivery could not be confirmed. Your redemption remains recorded.'));
        this.loadHistory();
      },
    });
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return typeof error.error?.message === 'string' ? error.error.message : fallback;
  }
}
