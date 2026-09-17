import { Component, computed, signal } from '@angular/core';

interface MemberSkill {
  name: string;
  rating: number;
}

interface MemberStat {
  label: string;
  value: string;
}

interface MemberProfile {
  name: string;
  role: string;
  location: string;
  profileImageUrl: string;
  memberSince: string;
  duprId: string;
  reClubId: string;
  stats: MemberStat[];
  skills: MemberSkill[];
}

@Component({
  selector: 'app-member-profile-page',
  imports: [],
  templateUrl: './member-profile-page.component.html',
  styleUrl: './member-profile-page.component.scss',
})
export class MemberProfilePageComponent {
  protected readonly member = signal<MemberProfile>({
    name: 'Alex Rivera',
    role: 'Club Member',
    location: 'Sorsogon Pickleball Club',
    profileImageUrl:
      'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=900&q=80',
    memberSince: '2026',
    duprId: 'DUPR-45891',
    reClubId: 'RECLUB-2048',
    stats: [
      { label: 'Open play sessions', value: '38' },
      { label: 'Completed games', value: '126' },
      { label: 'DUPR rating', value: '4.12' },
    ],
    skills: [
      { name: 'Serve', rating: 8 },
      { name: 'Return', rating: 7 },
      { name: 'Drive', rating: 8 },
      { name: 'Drop', rating: 6 },
      { name: 'Dink', rating: 7 },
      { name: 'Volley', rating: 9 },
      { name: 'Footwork', rating: 8 },
      { name: 'Court Awareness', rating: 9 },
    ],
  });

  protected readonly averageSkill = computed(() => {
    const skills = this.member().skills;

    if (!skills.length) {
      return '0.0';
    }

    const total = skills.reduce((sum, skill) => sum + skill.rating, 0);

    return (total / skills.length).toFixed(1);
  });

  protected skillProgress(rating: number) {
    return Math.min(Math.max(rating, 0), 10) * 10;
  }
}