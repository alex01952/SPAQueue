import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import { AdminRedemptionHistory, StoreItem } from './rewards.models';

@Component({
  selector: 'app-store-admin-page',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './store-admin-page.component.html',
  styleUrl: './rewards.scss',
})
export class StoreAdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly items = signal<StoreItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected form = this.emptyForm();
  protected readonly editing = signal<string | null>(null);
  protected readonly redemptions = signal<AdminRedemptionHistory | null>(null);
  protected readonly loadingRedemptions = signal(false);
  protected readonly redemptionsError = signal('');

  private emptyForm() {
    return { name: '', merchantEmail: '', merchantCc: '', merchantBcc: '', imageUrl: '', tokenCost: null as number | null, enabled: true, version: '' };
  }
  ngOnInit() { this.load(); this.loadRedemptions(); }

  protected loadRedemptions(more = false) {
    if (this.loadingRedemptions()) return;
    const continuation = more ? this.redemptions()?.continuationToken : null;
    if (more && !continuation) return;
    this.loadingRedemptions.set(true);
    this.redemptionsError.set('');
    this.http.get<AdminRedemptionHistory>(`${getApiBaseUrl()}/admin/redemptions`, {
      withCredentials: true,
      params: continuation ? { continuation } : {},
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (history) => {
        this.redemptions.set({
          ...history,
          records: more ? [...(this.redemptions()?.records ?? []), ...history.records] : history.records,
        });
        this.loadingRedemptions.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.redemptionsError.set(this.apiError(error, 'Unable to load redemptions.'));
        this.loadingRedemptions.set(false);
      },
    });
  }

  protected load() {
    if (this.loading() || this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    this.http.get<StoreItem[]>(`${getApiBaseUrl()}/admin/store`, { withCredentials: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (items) => { this.items.set(items); this.loading.set(false); },
        error: (error: HttpErrorResponse) => {
          this.error.set(this.apiError(error, 'Unable to load store items.'));
          this.loading.set(false);
        },
      });
  }

  protected edit(item: StoreItem) {
    if (this.busy()) return;
    this.editing.set(item.itemId);
    this.form = { ...item, merchantCc: item.merchantCc ?? '', merchantBcc: item.merchantBcc ?? '' };
    this.error.set('');
    this.message.set('');
  }

  protected reset() {
    if (this.busy()) return;
    this.editing.set(null);
    this.form = this.emptyForm();
  }

  protected upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.busy()) return;
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      this.error.set('Choose a PNG, JPEG, GIF, or WebP image up to 5 MB.');
      input.value = '';
      return;
    }
    const body = new FormData();
    body.append('image', file);
    this.busy.set(true);
    this.error.set('');
    this.http.post<{ imageUrl: string }>(`${getApiBaseUrl()}/admin/store-images`, body, { withCredentials: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ imageUrl }) => {
          this.form.imageUrl = imageUrl;
          this.busy.set(false);
          input.value = '';
        },
        error: (error: HttpErrorResponse) => {
          this.error.set(this.apiError(error, 'Image upload failed.'));
          this.busy.set(false);
          input.value = '';
        },
      });
  }

  protected recipientListError() {
    for (const [label, value, required] of [
      ['Merchant To', this.form.merchantEmail, true],
      ['Merchant CC', this.form.merchantCc, false],
      ['Merchant BCC', this.form.merchantBcc, false],
    ] as const) {
      if (value.length > 10_000 || /[\r\n]/.test(value)) {
        return `${label} must be a comma- or semicolon-separated email list (up to 10,000 characters).`;
      }
      if (!required && !value.trim()) continue;
      if (value.split(/[,;]/).some((entry) => {
        const email = entry.trim();
        return email.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email);
      })) {
        return `${label} must contain valid email addresses separated by commas or semicolons.`;
      }
      const emails = value.split(/[,;]/).map((email) => email.trim().toLowerCase());
      if ([...new Set(emails)].join(', ').length > 10_000) {
        return `${label} must not exceed 10,000 characters after formatting.`;
      }
    }
    return '';
  }

  protected save() {
    if (this.busy() || this.loading() || !this.form.imageUrl) return;
    const recipientError = this.recipientListError();
    if (recipientError) {
      this.error.set(recipientError);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    const id = this.editing();
    const request = id
      ? this.http.patch<StoreItem>(`${getApiBaseUrl()}/admin/store/${id}`, this.form, { withCredentials: true })
      : this.http.post<StoreItem>(`${getApiBaseUrl()}/admin/store`, this.form, { withCredentials: true });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.message.set('Store item saved.');
        this.reset();
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(this.apiError(error, 'Unable to save the store item. Refresh the catalog and check before retrying.'));
      },
    });
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return typeof error.error?.message === 'string' ? error.error.message : fallback;
  }
}
