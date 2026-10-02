import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import type { TournamentRegistration } from './tournament.types';
import { TournamentsPageComponent } from './tournaments-page.component';

describe('TournamentsPageComponent', () => {
  let fixture: ComponentFixture<TournamentsPageComponent>;
  const member = signal({ memberId: 'invited-member' });
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
});