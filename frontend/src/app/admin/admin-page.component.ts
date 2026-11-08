import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin-page',
  imports: [RouterLink],
  templateUrl: './admin-page.component.html',
  styleUrl: '../home/home-page.component.scss',
})
export class AdminPageComponent {
  protected readonly menuItems = [
    {
      label: 'Manage member roles',
      description: 'Assign member, club owner, balance staff, and admin access.',
      route: '/member-role-management',
    },
    {
      label: 'Rewards store',
      description: 'Configure rewards and merchants, and view all redemptions.',
      route: '/store-admin',
    },
    {
      label: 'Email announcements',
      description: 'Compose formatted emails for all members, a club, or selected users.',
      route: '/email-announcements',
    },
    {
      label: 'Open Play matching',
      description: 'Prepare the player list for an Open Play session.',
      route: '/open-play-matching',
    },
    {
      label: 'Upload participation',
      description: 'Upload Open Play participation files.',
      route: '/open-play-participation/upload',
    },
    {
      label: 'Registration approvals',
      description: 'Review verified applicants and approve member access.',
      route: '/member-registration-approvals',
    },
    {
      label: 'Manage clubs',
      description: 'Create clubs and appoint club officers.',
      route: '/club-management',
    },
    {
      label: 'Manage tournaments',
      description: 'Create tournaments and approve complete team registrations.',
      route: '/tournament-management',
    },
  ] as const;
}
