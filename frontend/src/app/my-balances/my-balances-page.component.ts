import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { getApiBaseUrl } from '../api-base-url';

interface MemberBalance {
  balanceId: string;
  memberId: string;
  balanceType: string;
  balanceDate: string;
  amount: number;
}

@Component({
  selector: 'app-my-balances-page',
  imports: [DecimalPipe],
  templateUrl: './my-balances-page.component.html',
  styleUrl: './my-balances-page.component.scss',
})
export class MyBalancesPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly balances = signal<MemberBalance[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal('');

  ngOnInit() {
    this.http
      .get<MemberBalance[]>(`${getApiBaseUrl()}/members/me/balances`, {
        withCredentials: true,
      })
      .subscribe({
        next: (balances) => {
          this.balances.set(balances);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            error.error?.message ?? 'Unable to load your balances. Please try again.',
          );
        },
      });
  }
}
