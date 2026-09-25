import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { getApiBaseUrl } from '../api-base-url';

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
  amount: number;
}

@Component({
  selector: 'app-member-balances-page',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './member-balances-page.component.html',
  styleUrl: './member-balances-page.component.scss',
})
export class MemberBalancesPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly members = signal<MemberSummary[]>([]);
  protected readonly balanceTypes = signal<string[]>([]);
  protected readonly selectedMember = signal<MemberSummary | null>(null);
  protected readonly balances = signal<MemberBalance[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly balanceType = signal('');
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
  }

  protected updateSearchTerm(value: string) {
    this.searchTerm.set(value);
  }

  protected selectMember(member: MemberSummary) {
    this.selectedMember.set(member);
    this.editingBalanceId.set(null);
    this.resetForm();
    this.feedbackMessage.set('');
    this.loadBalances(member.memberId);
  }

  protected clearSelectedMember() {
    this.selectedMember.set(null);
    this.balances.set([]);
    this.resetForm();
    this.feedbackMessage.set('');
  }

  protected startEdit(balance: MemberBalance) {
    this.editingBalanceId.set(balance.balanceId);
    this.balanceType.set(balance.balanceType);
    this.amount.set(balance.amount);
    this.feedbackMessage.set('');
  }

  protected cancelEdit() {
    this.editingBalanceId.set(null);
    this.resetForm();
  }

  protected saveBalance() {
    const member = this.selectedMember();
    const type = this.balanceType().trim();
    const amount = this.amount();
    if (!member || !type || amount === null || !Number.isFinite(amount)) {
      this.errorMessage.set('Select a balance type and enter a valid amount.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    const payload = { balanceType: type, amount };
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
    const member = this.selectedMember();
    if (!member || !window.confirm(`Delete ${balance.balanceType} balance?`)) {
      return;
    }

    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http
      .delete(`${getApiBaseUrl()}/members/${member.memberId}/balances/${balance.balanceId}`, {
        withCredentials: true,
      })
      .subscribe({
        next: () => {
          this.feedbackMessage.set('Balance deleted.');
          this.loadBalances(member.memberId);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(this.apiError(error, 'Unable to delete the balance.'));
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
    this.http
      .get<MemberBalance[]>(`${getApiBaseUrl()}/members/${memberId}/balances`, {
        withCredentials: true,
      })
      .subscribe({
        next: (balances) => this.balances.set(balances),
        error: (error: HttpErrorResponse) => {
          this.balances.set([]);
          this.errorMessage.set(this.apiError(error, 'Unable to load member balances.'));
        },
      });
  }

  private resetForm() {
    this.balanceType.set('');
    this.amount.set(null);
  }

  private apiError(error: HttpErrorResponse, fallback: string) {
    return error.error?.message ?? fallback;
  }
}
