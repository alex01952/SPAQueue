import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface MemberSummary {
  id: string;
  name: string;
  role: string;
  location: string;
  profileImageUrl: string;
}

@Component({
  selector: 'app-members-page',
  imports: [RouterLink],
  templateUrl: './members-page.component.html',
  styleUrl: './members-page.component.scss',
})
export class MembersPageComponent {
  protected readonly searchTerm = signal('');
  protected readonly members = signal<MemberSummary[]>([
    {
      id: 'alex-rivera',
      name: 'Alex Rivera',
      role: 'Club Member',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'mia-santos',
      name: 'Mia Santos',
      role: 'Arena Master',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'nico-reyes',
      name: 'Nico Reyes',
      role: 'Club Member',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'lea-cruz',
      name: 'Lea Cruz',
      role: 'Club Member',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'marco-lim',
      name: 'Marco Lim',
      role: 'Club Member',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80',
    },
    {
      id: 'ana-garcia',
      name: 'Ana Garcia',
      role: 'Club Member',
      location: 'Sorsogon Pickleball Club',
      profileImageUrl:
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    },
  ]);

  protected readonly filteredMembers = computed(() => {
    const searchTerm = this.searchTerm().trim().toLowerCase();

    if (!searchTerm) {
      return this.members();
    }

    return this.members().filter((member) =>
      [member.name, member.role, member.location].some((value) =>
        value.toLowerCase().includes(searchTerm),
      ),
    );
  });

  protected updateSearchTerm(value: string) {
    this.searchTerm.set(value);
  }
}