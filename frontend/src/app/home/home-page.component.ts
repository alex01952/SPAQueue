import { Component, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';
import { getApiBaseUrl } from '../api-base-url';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  private readonly auth = inject(MemberAuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  protected readonly member = this.auth.member;
  protected readonly isLoggingOut = signal(false);
  protected readonly logoutError = signal('');
  protected readonly isSendingVerification = signal(false);
  protected readonly verificationMessage = signal('');
  protected readonly verificationError = signal('');
  protected readonly memberHasBalances = signal(false);
  protected readonly balancesError = signal('');
  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/Logo.png';
  protected readonly menuItems = [
    {
      label: 'Profile',
      description: 'View your member identity, ratings, and activity.',
      route: '/member-profile',
      index: '01',
    },
    {
      label: 'Members',
      description: 'Browse the people who make up the club.',
      route: '/members',
      index: '02',
    },
    {
      label: 'Clubs',
      description: 'Find club information and playing communities.',
      route: '/clubs',
      index: '03',
    },
    {
      label: 'Masters of the Arena',
      description: 'See players who reached the participation threshold.',
      route: '/masters-of-the-arena',
      index: '04',
    },
  ] as const;

  constructor() {
    this.loadMemberBalanceStatus();
  }

  private loadMemberBalanceStatus() {
    this.http
      .get<unknown[]>(`${getApiBaseUrl()}/members/me/balances`, {
        withCredentials: true,
      })
      .subscribe({
        next: (balances) => this.memberHasBalances.set(balances.length > 0),
        error: (error: HttpErrorResponse) => {
          this.balancesError.set(
            error.error?.message ?? 'Unable to check balance status.',
          );
        },
      });
  }

  protected logout() {
    if (this.isLoggingOut()) {
      return;
    }

    this.isLoggingOut.set(true);
    this.logoutError.set('');
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login'], { replaceUrl: true }),
      error: () => {
        this.logoutError.set('Unable to log out. Please try again.');
        this.isLoggingOut.set(false);
      },
    });
  }

  protected sendVerificationEmail() {
    if (this.isSendingVerification() || this.member()?.emailValidated) {
      return;
    }

    this.isSendingVerification.set(true);
    this.verificationMessage.set('');
    this.verificationError.set('');
    this.auth.requestEmailVerification().subscribe({
      next: (result) => {
        this.verificationMessage.set(
          `Verification email sent to ${result.email}. Check your inbox.`,
        );
        this.isSendingVerification.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.verificationError.set(
          error.error?.message ??
            'Unable to send a verification email. Please try again.',
        );
        this.isSendingVerification.set(false);
      },
    });
  }
}