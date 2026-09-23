import { Component, computed, inject } from '@angular/core';
import { MemberAuthService } from '../member-auth.service';

interface MemberSkill {
  name: string;
  rating: number;
}

@Component({
  selector: 'app-member-profile-page',
  imports: [],
  templateUrl: './member-profile-page.component.html',
  styleUrl: './member-profile-page.component.scss',
})
export class MemberProfilePageComponent {
  private readonly auth = inject(MemberAuthService);

  protected readonly member = this.auth.member;
  protected readonly skills = computed<MemberSkill[]>(() =>
    Object.entries(this.member()?.skills ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([name, rating]) => ({
        name: name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/^./, (letter) => letter.toUpperCase()),
        rating,
      })),
  );
  protected readonly memberSince = computed(() => {
    const createdAt = this.member()?.createdAt;
    const date = createdAt ? new Date(createdAt) : null;

    return date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(date)
      : 'Not available';
  });
  protected readonly initials = computed(() =>
    (this.member()?.name ?? 'Member')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(''),
  );

  protected readonly averageSkill = computed(() => {
    const skills = this.skills();

    if (!skills.length) {
      return '0.0';
    }

    const total = skills.reduce((sum, skill) => sum + skill.rating, 0);

    return (total / skills.length).toFixed(1);
  });

  protected publicDetail(value: string | number | null) {
    return value === null || value === '' ? 'Not provided' : String(value);
  }

  protected skillProgress(rating: number) {
    return Math.min(Math.max(rating, 0), 10) * 10;
  }
}