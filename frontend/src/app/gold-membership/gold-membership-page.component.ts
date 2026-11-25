import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { MemberAuthService } from '../member-auth.service';

interface GoldApplication {
  id: string;
  memberId: string;
  name: string;
  reClubId: string;
  status: 'Pending' | 'Approved' | 'Declined';
  submittedAt: string;
  reviewedAt: string | null;
  declineReason: string;
  expiresOn: string | null;
  paymentMethod: 'receipt' | 'arena-counter';
  receiptFileName: string | null;
}

interface GoldState {
  activeGold: boolean;
  goldMembershipExpiresOn: string | null;
  documentAvailable: boolean;
  application: GoldApplication | null;
}

@Component({
  selector: 'app-gold-membership-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './gold-membership-page.component.html',
  styleUrls: ['../rewards/rewards.scss', './gold-membership.scss'],
})
export class GoldMembershipPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(MemberAuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly adminPage = inject(ActivatedRoute).snapshot.data['adminApplications'] === true;
  protected readonly baseUrl = `${getApiBaseUrl()}/gold-membership`;
  protected readonly state = signal<GoldState | null>(null);
  protected readonly applications = signal<GoldApplication[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly selected = signal<{ application: GoldApplication; decision: 'approve' | 'decline' } | null>(null);
  protected status = 'Pending';
  protected declineReason = '';
  protected receipt: File | null = null;
  protected paymentMethod: GoldApplication['paymentMethod'] = 'receipt';
  protected documentFile: File | null = null;
  private requestId = crypto.randomUUID();

  ngOnInit() { this.load(); }

  protected load() {
    if (this.loading() || this.saving()) return;
    this.loading.set(true);
    this.error.set('');
    this.selected.set(null);
    this.state.set(null);
    this.applications.set([]);
    forkJoin({
      state: this.http.get<GoldState>(this.baseUrl, { withCredentials: true }),
      applications: this.adminPage
        ? this.http.get<GoldApplication[]>(`${this.baseUrl}/applications`, { withCredentials: true, params: { status: this.status } })
        : of([] as GoldApplication[]),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ state, applications }) => {
        this.state.set(state);
        this.applications.set(applications);
        const member = this.auth.member();
        if (member) this.auth.updateAuthenticatedMember({ ...member, goldMembershipExpiresOn: state.goldMembershipExpiresOn });
        if (state.application?.id === this.requestId && state.application.status !== 'Pending') this.requestId = crypto.randomUUID();
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.apiError(error, 'Unable to load Gold membership information.'));
        this.loading.set(false);
      },
    });
  }

  protected selectFile(event: Event, kind: 'receipt' | 'document') {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0] ?? null;
    if (kind === 'receipt') this.receipt = null;
    else this.documentFile = null;
    if (!file) return;
    const types = kind === 'document' ? ['application/pdf'] : ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!types.includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
      input.value = '';
      this.error.set(kind === 'document' ? 'Choose a PDF no larger than 10 MB.' : 'Choose a PDF, JPEG, PNG or WebP receipt no larger than 10 MB.');
      return;
    }
    this.error.set('');
    if (kind === 'receipt') this.receipt = file;
    else this.documentFile = file;
  }

  protected receiptUrl(application: GoldApplication) {
    return `${this.baseUrl}/applications/${encodeURIComponent(application.memberId)}/${encodeURIComponent(application.id)}/receipt`;
  }

  protected submit() {
    if (this.saving() || this.loading()) return;
    if (this.paymentMethod === 'receipt' && !this.receipt) { this.error.set('Choose your payment receipt first.'); return; }
    const data = new FormData();
    data.append('requestId', this.requestId);
    data.append('paymentMethod', this.paymentMethod);
    if (this.paymentMethod === 'receipt' && this.receipt) data.append('receipt', this.receipt);
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.http.post<GoldApplication>(`${this.baseUrl}/applications`, data, { withCredentials: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.receipt = null;
          this.saving.set(false);
          this.message.set('Application submitted. An admin will review your payment.');
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.apiError(error, 'Unable to submit your application. Refresh to check its status before retrying.'));
        },
      });
  }

  protected uploadDocument(input: HTMLInputElement) {
    if (this.saving() || this.loading()) return;
    if (!this.documentFile) { this.error.set('Choose the benefits and rate PDF first.'); return; }
    const data = new FormData();
    data.append('document', this.documentFile);
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.http.put(`${this.baseUrl}/document`, data, { withCredentials: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.documentFile = null;
          input.value = '';
          this.saving.set(false);
          this.message.set('Benefits and rate document updated.');
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.apiError(error, 'Unable to upload the benefits and rate document.'));
        },
      });
  }

  protected chooseReview(application: GoldApplication, decision: 'approve' | 'decline') {
    this.declineReason = '';
    this.selected.set({ application, decision });
  }

  protected review() {
    const selected = this.selected();
    if (!selected || this.saving() || this.loading()) return;
    if (selected.decision === 'decline' && (!this.declineReason.trim() || this.declineReason.trim().length > 1000)) {
      this.error.set('Enter a decline reason of 1 to 1,000 characters.');
      return;
    }
    const application = selected.application;
    const url = `${this.baseUrl}/applications/${encodeURIComponent(application.memberId)}/${encodeURIComponent(application.id)}/${selected.decision}`;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.http.patch<GoldApplication>(url, selected.decision === 'decline' ? { reason: this.declineReason.trim() } : {}, { withCredentials: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          this.saving.set(false);
          this.selected.set(null);
          this.message.set(result.status === 'Approved'
            ? `Application approved. Gold membership expires on ${result.expiresOn}.`
            : 'Application declined. The member can see the reason and apply again.');
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.apiError(error, 'Unable to review the application. Refresh the list before retrying.'));
        },
      });
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return typeof error.error?.message === 'string' ? error.error.message : fallback;
  }
}
