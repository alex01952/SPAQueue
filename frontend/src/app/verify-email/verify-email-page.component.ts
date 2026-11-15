import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';

@Component({
  selector: 'app-verify-email-page',
  imports: [RouterLink],
  templateUrl: './verify-email-page.component.html',
  styleUrl: './verify-email-page.component.scss',
})
export class VerifyEmailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(MemberAuthService);

  protected readonly status = signal<'verifying' | 'verified' | 'error'>('verifying');
  protected readonly message = signal('Verifying your email address.');
  protected readonly canLogin = signal(false);

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.status.set('error');
      this.message.set('This verification link is invalid or incomplete.');
      return;
    }

    this.auth.confirmEmailVerification(token).subscribe({
      next: (result) => {
        this.status.set('verified');
        this.canLogin.set(result.canLogin);
        this.message.set(
          result.canLogin
            ? 'Your email is verified and your account is approved. You can now log in.'
            : 'Your email is verified, but your account is not approved. Please contact an administrator.',
        );
      },
      error: (error: HttpErrorResponse) => {
        this.status.set('error');
        this.message.set(
          error.status === 400
            ? 'This verification link is invalid or has expired.'
            : 'Your email could not be verified. Please try the link again.',
        );
      },
    });
  }
}
