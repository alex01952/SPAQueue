import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { getApiBaseUrl } from '../api-base-url';
import { MemberAuthService, MemberRole } from '../member-auth.service';

interface MemberSummary {
  memberId: string;
  name: string;
  role: string;
  clubName: string;
  profileImageUrl: string;
}

interface MemberBalance {
  balanceId: string;
  memberId: string;
  balanceType: string;
  balanceDate: string;
  amount: number;
}

@Component({
  selector: 'app-member-balances-page',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './member-balances-page.component.html',
  styleUrl: './member-balances-page.component.scss',
})
export class MemberBalancesPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(MemberAuthService);
  private clockTimer?: ReturnType<typeof setInterval>;
  private readonly now = signal(Date.now());
  protected readonly nextReminderAt = signal<string | null>(null);
  protected readonly reminderStatusLoaded = signal(false);
  protected readonly isReminding = signal(false);
  protected readonly isAssigningRole = signal(false);
  protected readonly isLoadingBalances = signal(false);
  protected readonly reminderCoolingDown = computed(() =>
    !!this.nextReminderAt() && Date.parse(this.nextReminderAt()!) > this.now());
  protected readonly operationPending = computed(() =>
    this.isSaving() || this.isReminding() || this.isAssigningRole());
  protected readonly outstandingTotal = computed(() =>
    this.balances().reduce((sum, balance) => sum + Math.round(balance.amount * 100), 0) / 100);
  protected readonly canAssignBalanceRole = computed(() => {
    const role = this.selectedMember()?.role.toLowerCase();
    return this.auth.member()?.role === 'admin' &&
      !!role && ['member', 'club member', 'balance-staff'].includes(role);
  });

  protected readonly members = signal<MemberSummary[]>([]);
  protected readonly balanceTypes = signal<string[]>([]);
  protected readonly selectedMember = signal<MemberSummary | null>(null);
  protected readonly balances = signal<MemberBalance[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly balanceType = signal('');
  protected readonly balanceDate = signal('');
  protected readonly amount = signal<number | null>(null);
  protected readonly editingBalanceId = signal<string | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');

  protected readonly filteredMembers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      return this.members();
    }

    return this.members().filter((member) =>
      [member.name, member.memberId, member.role, member.clubName].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  });

  ngOnInit() {
    this.loadInitialData();
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy() {
    clearInterval(this.clockTimer);
  }

  protected updateSearchTerm(value: string) {
    this.searchTerm.set(value);
  }

  protected selectMember(member: MemberSummary) {
    if (this.operationPending()) return;
    this.selectedMember.set(member);
    this.editingBalanceId.set(null);
    this.resetForm();
    this.feedbackMessage.set('');
    this.errorMessage.set('');
    this.balances.set([]);
    this.nextReminderAt.set(null);
    this.loadReminderStatus(member.memberId);
    this.loadBalances(member.memberId);
  }

  protected clearSelectedMember() {
    if (this.operationPending()) return;
    this.selectedMember.set(null);
    this.balances.set([]);
    this.resetForm();
    this.feedbackMessage.set('');
  }

  protected startEdit(balance: MemberBalance) {
    if (this.operationPending()) return;
    this.editingBalanceId.set(balance.balanceId);
    this.balanceType.set(balance.balanceType);
    this.balanceDate.set(balance.balanceDate);
    this.amount.set(balance.amount);
    this.feedbackMessage.set('');
  }

  protected cancelEdit() {
    this.editingBalanceId.set(null);
    this.resetForm();
  }

  protected saveBalance() {
    if (this.operationPending()) return;
    const member = this.selectedMember();
    const type = this.balanceType().trim();
    const date = this.balanceDate();
    const amount = this.amount();
    if (!member || !type || !date || amount === null || !Number.isFinite(amount)) {
      this.errorMessage.set('Select a balance type, date, and valid amount.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    const payload = { balanceType: type, balanceDate: date, amount };
    const editingId = this.editingBalanceId();
    const request = editingId
      ? this.http.patch<MemberBalance>(
          `${getApiBaseUrl()}/members/${member.memberId}/balances/${editingId}`,
          payload,
          { withCredentials: true },
        )
      : this.http.post<MemberBalance>(
          `${getApiBaseUrl()}/members/${member.memberId}/balances`,
          payload,
          { withCredentials: true },
        );

    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.feedbackMessage.set(editingId ? 'Balance updated.' : 'Balance added.');
        this.editingBalanceId.set(null);
        this.resetForm();
        this.loadBalances(member.memberId);
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.errorMessage.set(this.apiError(error, 'Unable to save the balance.'));
      },
    });
  }

  protected deleteBalance(balance: MemberBalance) {
    if (this.operationPending()) return;
    const member = this.selectedMember();
    if (!member || !window.confirm(`Delete ${balance.balanceType} balance?`)) {
      return;
    }

    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.isSaving.set(true);
    this.http
      .delete(`${getApiBaseUrl()}/members/${member.memberId}/balances/${balance.balanceId}`, {
        withCredentials: true,
      })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.feedbackMessage.set('Balance deleted.');
          this.loadBalances(member.memberId);
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.errorMessage.set(this.apiError(error, 'Unable to delete the balance.'));
        },
      });
  }

  protected setBalanceStaff(enabled: boolean) {
    const member = this.selectedMember();
    if (!member || !this.canAssignBalanceRole() || this.operationPending()) return;
    const role: MemberRole = enabled ? 'balance-staff' : 'member';
    if (!window.confirm(`${enabled ? 'Grant balance staff access to' : 'Remove balance staff access from'} ${member.name}? This does not grant access to other admin pages.`)) return;
    this.isAssigningRole.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<{ memberId: string; role: MemberRole }>(
      `${getApiBaseUrl()}/members/${encodeURIComponent(member.memberId)}/role`,
      { role }, { withCredentials: true },
    ).subscribe({
      next: (result) => {
        this.isAssigningRole.set(false);
        const updated = { ...member, role: result.role };
        this.members.update((members) => members.map((item) => item.memberId === member.memberId ? updated : item));
        this.selectedMember.set(updated);
        this.feedbackMessage.set(enabled ? 'Balance staff access granted.' : 'Balance staff access removed.');
      },
      error: (error: HttpErrorResponse) => {
        this.isAssigningRole.set(false);
        this.errorMessage.set(this.apiError(error, 'Unable to update balance staff access.'));
      },
    });
  }

  protected remindMember() {
    const member = this.selectedMember();
    if (!member || this.operationPending() || this.isLoadingBalances() ||
        !this.reminderStatusLoaded() || this.reminderCoolingDown() || this.outstandingTotal() <= 0) return;
    if (!window.confirm(`Email ${member.name} all current unpaid balances? Only one reminder can be triggered per member every 24 hours across all staff and admins.`)) return;
    this.isReminding.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.post<{ sent: true; nextAllowedAt: string }>(
      `${getApiBaseUrl()}/members/${encodeURIComponent(member.memberId)}/balance-reminder`,
      {}, { withCredentials: true },
    ).subscribe({
      next: (result) => {
        this.isReminding.set(false);
        this.nextReminderAt.set(result.nextAllowedAt);
        this.now.set(Date.now());
        this.feedbackMessage.set('Balance reminder email sent.');
      },
      error: (error: HttpErrorResponse) => {
        this.isReminding.set(false);
        this.errorMessage.set(this.apiError(error, 'Unable to confirm reminder delivery. Reload the reminder status before retrying.'));
        this.loadReminderStatus(member.memberId);
      },
    });
  }

  protected loadReminderStatus(memberId: string) {
    this.reminderStatusLoaded.set(false);
    this.http.get<{ nextAllowedAt: string | null }>(
      `${getApiBaseUrl()}/members/${encodeURIComponent(memberId)}/balance-reminder`,
      { withCredentials: true },
    ).subscribe({
      next: (status) => {
        if (this.selectedMember()?.memberId !== memberId) return;
        this.nextReminderAt.set(status.nextAllowedAt);
        this.now.set(Date.now());
        this.reminderStatusLoaded.set(true);
      },
      error: (error: HttpErrorResponse) => {
        if (this.selectedMember()?.memberId !== memberId) return;
        this.errorMessage.set(this.apiError(error, 'Unable to load reminder status. Reload the reminder status to enable reminders.'));
      },
    });
  }

  private loadInitialData() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.http
      .get<MemberSummary[]>(`${getApiBaseUrl()}/members`, { withCredentials: true })
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.loadBalanceTypes();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(this.apiError(error, 'Unable to load members.'));
        },
      });
  }

  private loadBalanceTypes() {
    this.http
      .get<string[]>(`${getApiBaseUrl()}/balance-types`, { withCredentials: true })
      .subscribe({
        next: (types) => {
          this.balanceTypes.set(types);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(this.apiError(error, 'Unable to load balance types.'));
        },
      });
  }

  private loadBalances(memberId: string) {
    this.isLoadingBalances.set(true);
    this.http
      .get<MemberBalance[]>(`${getApiBaseUrl()}/members/${memberId}/balances`, {
        withCredentials: true,
      })
      .subscribe({
        next: (balances) => {
          if (this.selectedMember()?.memberId !== memberId) return;
          this.balances.set(balances);
          this.isLoadingBalances.set(false);
        },
        error: (error: HttpErrorResponse) => {
          if (this.selectedMember()?.memberId !== memberId) return;
          this.balances.set([]);
          this.isLoadingBalances.set(false);
          this.errorMessage.set(this.apiError(error, 'Unable to load member balances.'));
        },
      });
  }

  private resetForm() {
    this.balanceType.set('');
    this.balanceDate.set('');
    this.amount.set(null);
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return error.error?.message ?? fallback;
  }
}
