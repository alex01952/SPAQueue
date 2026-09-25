import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss',
})
export class LandingPageComponent {
  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/SPCLogo.png';

  protected readonly playerBenefits = [
    ['Find your level', 'Discover players with similar skills for more competitive, enjoyable games.'],
    ['Find your partner', 'Connect with potential partners through strengths, weaknesses, and playing style.'],
    ['Understand your game', 'Build a skill profile that makes your progress visible and actionable.'],
    ['Play with commitment', 'Join Open Plays and reserve courts using cash commitments, without online prepayment.'],
    ['Track your balance', 'Keep a clear view of outstanding balances and Arena activity.'],
  ];

  protected readonly organizerBenefits = [
    ['Manage members', 'Keep club information in one connected member database.'],
    ['Track skills', 'Use player assessments to organize games, divisions, and pools.'],
    ['Run tournaments', 'Build divisions, randomized pools, and schedules with better player context.'],
    ['Grow the toolkit', 'Open Play queuing, matchmaking, and more organizer tools are on the way.'],
  ];

  protected readonly arenaBenefits = [
    ['Membership management', 'Maintain verified member activity in one connected portal.'],
    ['Balance tracking', 'Keep court bookings and Open Play commitments visible.'],
    ['Loyalty and rewards', 'Create future opportunities for active members to earn meaningful benefits.'],
  ];
}
