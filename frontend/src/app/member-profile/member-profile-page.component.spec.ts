import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MemberAuthService } from '../member-auth.service';
import { MemberProfilePageComponent } from './member-profile-page.component';

describe('MemberProfilePageComponent', () => {
  it('should render the authenticated member entity without mock profile data', async () => {
    const member = signal({
      memberId: 'member-1',
      email: 'jamie@example.com',
      name: 'Jamie Santos',
      contactNo: '09123456789',
      emergencyContact: 'Taylor Santos',
      age: 29,
      gender: 'Non-binary',
      duprId: 'DUPR-789',
      reClubId: 'RECLUB-321',
      profileImageUrl: '',
      skills: { serve: 8, courtAwareness: 7 },
      createdAt: '2026-02-18T09:30:00.000Z',
    });
    await TestBed.configureTestingModule({
      imports: [MemberProfilePageComponent],
      providers: [
        {
          provide: MemberAuthService,
          useValue: { member: member.asReadonly() },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MemberProfilePageComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Jamie Santos');
    expect(text).toContain('DUPR-789');
    expect(text).toContain('RECLUB-321');
    expect(text).toContain('Non-binary');
    expect(text).toContain('Court Awareness');
    expect(text).not.toContain('jamie@example.com');
    expect(text).not.toContain('09123456789');
    expect(text).not.toContain('Taylor Santos');
    expect(text).not.toContain('Alex Rivera');
    expect(text).not.toContain('126');
  });
});