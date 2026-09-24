import { Component, inject, OnInit, signal } from '@angular/core';
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

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.status.set('error');
      this.message.set('This verification link is invalid or incomplete.');
      return;
    }

    this.auth.confirmEmailVerification(token).subscribe({
      next: () => {
        this.status.set('verified');
        this.message.set('Your email address has been verified.');
      },
      error: () => {
        this.status.set('error');
        this.message.set('This verification link is invalid or has expired.');
      },
    });
  }
}