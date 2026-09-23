import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  private readonly auth = inject(MemberAuthService);
  private readonly router = inject(Router);

  protected readonly member = this.auth.member;
  protected readonly isLoggingOut = signal(false);
  protected readonly logoutError = signal('');
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
    {
      label: 'Queueing',
      description: 'Manage check-ins, courts, and the next games.',
      route: '/queue-dashboard',
      index: '05',
    },
  ] as const;

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
}