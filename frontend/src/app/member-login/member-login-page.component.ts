import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';
import { getApiBaseUrl } from '../api-base-url';

@Component({
  selector: 'app-member-login-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './member-login-page.component.html',
  styleUrl: './member-login-page.component.scss',
})
export class MemberLoginPageComponent {
  private readonly auth = inject(MemberAuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly isSubmitting = signal(false);
  protected readonly loginError = signal('');
  protected readonly isResendingVerification = signal(false);
  protected readonly resendVerificationMessage = signal('');
  protected readonly resendVerificationError = signal('');

  protected submitLogin() {
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.loginError.set('');
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        const requestedUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const destination = requestedUrl?.startsWith('/') ? requestedUrl : '/home';

        void this.router.navigateByUrl(destination);
      },
      error: (error: HttpErrorResponse) => {
        this.loginError.set(
          error.status === 401
            ? 'The email or password is incorrect.'
            : error.status === 403
              ? (error.error?.message ?? 'Your registration is pending approval.')
              : 'Login is temporarily unavailable. Please try again.',
        );
        this.isSubmitting.set(false);
      },
    });
  }

  protected resendVerificationEmail() {
    if (this.isResendingVerification()) {
      return;
    }

    const email = this.email.trim();
    if (!email) {
      this.resendVerificationError.set(
        'Enter your registration email address to receive a new verification link.',
      );
      this.resendVerificationMessage.set('');
      return;
    }

    this.isResendingVerification.set(true);
    this.resendVerificationMessage.set('');
    this.resendVerificationError.set('');
    this.http
      .post<{ sent: true; email: string }>(
        `${getApiBaseUrl()}/members/email-verification/resend`,
        { email },
        { withCredentials: true },
      )
      .subscribe({
        next: (result) => {
          this.resendVerificationMessage.set(
            `A new verification link was sent to ${result.email}.`,
          );
          this.isResendingVerification.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.resendVerificationError.set(
            error.error?.message ??
              'Unable to resend the verification email. Please try again.',
          );
          this.isResendingVerification.set(false);
        },
      });
  }
}
