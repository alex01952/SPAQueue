import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import type { TournamentRegistration } from './tournament.types';
import { TournamentsPageComponent } from './tournaments-page.component';

describe('TournamentsPageComponent', () => {
  let fixture: ComponentFixture<TournamentsPageComponent>;
  const member = signal({ memberId: 'invited-member', gender: 'Male' });
  const http = {
    get: vi.fn(() => of([])),
    post: vi.fn(() => of({})),
  };

  beforeEach(async () => {
    http.get.mockClear();
    http.post.mockClear();
    await TestBed.configureTestingModule({
      imports: [TournamentsPageComponent],
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: MemberAuthService, useValue: { member: member.asReadonly() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentsPageComponent);
    fixture.detectChanges();
  });

  it('recognizes an incoming pending invitation when the API omits its marker', () => {
    const invitation = {
      status: 'Invitation Pending',
      partnerId: 'invited-member',
    } as TournamentRegistration;

    expect((fixture.componentInstance as any).isIncomingInvitation(invitation)).toBe(true);
  });

  it('requires three teammates and a two-men, two-women roster before submitting', () => {
    const component = fixture.componentInstance as any;
    component.activeTournament.set({ category: 'Team Tournament' });
    const maleTeammate = { memberId: 'male-2', name: 'Male Two', gender: 'Male', eligible: true };
    const extraMale = { memberId: 'male-3', name: 'Male Three', gender: 'Male', eligible: true };
    const firstWoman = { memberId: 'female-1', name: 'Female One', gender: 'Female', eligible: true };
    const secondWoman = { memberId: 'female-2', name: 'Female Two', gender: 'Female', eligible: true };

    component.toggleTeamMember(maleTeammate);
    expect(component.canToggleTeamMember(extraMale)).toBe(false);
    component.toggleTeamMember(extraMale);
    component.toggleTeamMember(firstWoman);
    component.toggleTeamMember(secondWoman);

    expect(component.isTeamRosterComplete()).toBe(true);
    Object.assign(component.memberExperienceForm, {
      hasJoinedTournaments: false,
      hasWonTournaments: false,
    });
    component.register();

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/registrations'),
      expect.objectContaining({
        partnerId: 'male-2',
        teamMemberIds: ['male-2', 'female-1', 'female-2'],
      }),
      { withCredentials: true },
    );
  });
});