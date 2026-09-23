import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';

@Component({
  selector: 'app-member-login-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './member-login-page.component.html',
  styleUrl: './member-login-page.component.scss',
})
export class MemberLoginPageComponent {
  private readonly auth = inject(MemberAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly isSubmitting = signal(false);
  protected readonly loginError = signal('');

  protected submitLogin() {
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.loginError.set('');
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        const requestedUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const destination = requestedUrl?.startsWith('/')
          ? requestedUrl
          : '/home';

        void this.router.navigateByUrl(destination);
      },
      error: (error: HttpErrorResponse) => {
        this.loginError.set(
          error.status === 401
            ? 'The email or password is incorrect.'
            : 'Login is temporarily unavailable. Please try again.',
        );
        this.isSubmitting.set(false);
      },
    });
  }
}