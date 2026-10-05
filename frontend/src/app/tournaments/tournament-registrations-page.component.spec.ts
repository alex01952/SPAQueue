import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TournamentRegistrationsPageComponent } from './tournament-registrations-page.component';

describe('TournamentRegistrationsPageComponent', () => {
  it('shows every registration status for the selected tournament and filters by status', async () => {
    await TestBed.configureTestingModule({
      imports: [TournamentRegistrationsPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(TournamentRegistrationsPageComponent);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http.expectOne(({ url }) => url.endsWith('/tournaments')).flush([
      {
        tournamentId: 'event-1', name: 'Club Open', category: 'Mixed Doubles', level: 'Intermediate',
        maxSlots: 12, date: '', location: '', registrationCount: 4, createdAt: '2026-10-01',
      },
    ]);
    http.expectOne(({ url }) => url.endsWith('/admin/tournament-registrations')).flush([
      { tournamentId: 'event-1', registrationId: 'member-a', tournamentName: 'Club Open', category: 'Mixed Doubles', level: 'Intermediate', memberId: 'member-a', memberName: 'Alex', partnerId: 'member-b', partnerName: 'Blair', status: 'Invitation Pending', registeredAt: '2026-10-01' },
      { tournamentId: 'event-1', registrationId: 'member-c', tournamentName: 'Club Open', category: 'Mixed Doubles', level: 'Intermediate', memberId: 'member-c', memberName: 'Casey', partnerId: 'member-d', partnerName: 'Drew', status: 'Pending Approval', registeredAt: '2026-10-02' },
      { tournamentId: 'event-1', registrationId: 'member-e', tournamentName: 'Club Open', category: 'Mixed Doubles', level: 'Intermediate', memberId: 'member-e', memberName: 'Eli', partnerId: 'member-f', partnerName: 'Fin', status: 'Approved', registeredAt: '2026-10-03' },
    ]);

    const component = fixture.componentInstance as any;
    component.setTournament('event-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Awaiting partner');
    expect(fixture.nativeElement.textContent).toContain('Accepted · awaiting admin');
    expect(fixture.nativeElement.textContent).toContain('Approved');

    const profileLinks = fixture.nativeElement.querySelectorAll('.member-profile-link') as NodeListOf<HTMLAnchorElement>;
    expect(profileLinks).toHaveLength(6);
    profileLinks[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('iframe')?.getAttribute('src')).toBe('/member-profile/member-a?embedded=true');

    component.setStatusFilter('Pending Approval');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Casey + Drew');
    expect(fixture.nativeElement.textContent).not.toContain('Alex + Blair');
    http.verify();
  });
});