import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';

@Component({
  selector: 'app-reset-password-page',
  imports: [FormsModule, RouterLink],
  styleUrl: '../member-login/member-login-page.component.scss',
  template: `
    <main class="login-shell">
      <section class="login-layout" aria-labelledby="reset-title">
        <div class="login-scene" aria-hidden="true"><div class="court-lines"></div><p>SPA</p><strong>Play starts here.</strong></div>
        <section class="login-panel">
          <header><p class="eyebrow">Member access</p><h1 id="reset-title">Reset password</h1></header>
          @if (complete()) {
            <p class="resend-message success" role="status">Your password has been updated. Sign in with your new password.</p>
          } @else if (!token) {
            <p class="error-banner" role="alert">This reset link is invalid or incomplete.</p>
          } @else {
            <form #resetForm="ngForm" (ngSubmit)="submit()">
              <label><span>New password (at least 8 characters)</span><input type="password" name="password" [(ngModel)]="password" minlength="8" autocomplete="new-password" required /></label>
              <label><span>Confirm new password</span><input type="password" name="confirmation" [(ngModel)]="confirmation" minlength="8" autocomplete="new-password" required /></label>
              @if (error()) { <p class="error-banner" role="alert">{{ error() }}</p> }
              <button type="submit" [disabled]="resetForm.invalid || submitting()">{{ submitting() ? 'Updating password...' : 'Update password' }}</button>
            </form>
          }
          <p class="registration-link"><a routerLink="/login">Return to login</a></p>
        </section>
      </section>
    </main>
  `,
})
export class ResetPasswordPageComponent {
  private readonly http = inject(HttpClient);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  protected password = '';
  protected confirmation = '';
  protected readonly submitting = signal(false);
  protected readonly complete = signal(false);
  protected readonly error = signal('');

  protected submit() {
    if (this.submitting()) return;
    if (this.password.length < 8) {
      this.error.set('Password must contain at least 8 characters.');
      return;
    }
    if (this.password !== this.confirmation) {
      this.error.set('Passwords do not match.');
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    this.http.post(`${getApiBaseUrl()}/members/password-reset/confirm`, { token: this.token, password: this.password }).subscribe({
      next: () => {
        this.password = '';
        this.confirmation = '';
        this.complete.set(true);
        this.submitting.set(false);
      },
      error: (error) => {
        this.error.set(error.status === 400 ? 'This reset link is invalid or expired. Request a new link from the login page.' : 'Unable to update your password. Please try again.');
        this.submitting.set(false);
      },
    });
  }
}