import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TournamentRegistrationsPageComponent } from './tournament-registrations-page.component';
import type { TournamentRegistration } from './tournament.types';

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
        maxSlots: 12, date: '', location: '', registrationCount: 1, pendingRegistrationCount: 2, createdAt: '2026-10-01',
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
    expect(component.approvedTeamCount()).toBe(1);
    expect(component.pendingTeamCount()).toBe(2);

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

  describe('Tournament registration payments', () => {
    let fixture: ComponentFixture<TournamentRegistrationsPageComponent>;
    let http: HttpTestingController;
    const registration: TournamentRegistration = {
      tournamentId: 'event-1', registrationId: 'captain', tournamentName: 'Club Open',
      category: 'Mixed Doubles', level: 'Intermediate',
      memberId: 'captain', memberName: 'Captain', partnerId: 'partner', partnerName: 'Partner',
      status: 'Approved', registeredAt: '2026-10-19',
    };

    beforeEach(async () => {
      vi.restoreAllMocks();
      await TestBed.configureTestingModule({
        imports: [TournamentRegistrationsPageComponent],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      }).compileComponents();
      fixture = TestBed.createComponent(TournamentRegistrationsPageComponent);
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      http.expectOne(({ url }) => url.endsWith('/tournaments')).flush([{
        tournamentId: 'event-1', name: 'Club Open', category: 'Mixed Doubles', level: 'Intermediate',
        maxSlots: 8, registrationCount: 1, pendingRegistrationCount: 0, date: '', location: '', createdAt: '',
      }]);
      http.expectOne(({ url }) => url.endsWith('/admin/tournament-registrations')).flush([registration]);
      (fixture.componentInstance as any).setTournament('event-1');
      fixture.detectChanges();
    });

    afterEach(() => { http.verify(); });

    it('marks an approved registration paid without proofs and updates the paid filter', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
        .find((item) => item.textContent?.includes('Mark as paid'))!;
      button.click();
      const request = http.expectOne(({ url }) => url.endsWith('/registrations/captain/paid'));
      expect(request.request.method).toBe('PATCH');
      expect(request.request.withCredentials).toBe(true);
      request.flush({ ...registration, status: 'Paid', paidAt: '2026-10-19T00:00:00Z', paidBy: 'admin' });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Registration marked as paid');
      expect(fixture.nativeElement.textContent).not.toContain('Mark as paid');
      (fixture.componentInstance as any).setStatusFilter('Paid');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Captain');
    });

    it('lists all uploaded proofs and still allows payment confirmation with partial proofs', () => {
      (fixture.componentInstance as any).registrations.set([{
        ...registration, status: 'Payment Submitted',
        paymentProofs: ['captain', 'partner'].map((memberId) => ({
          memberId, memberName: memberId, fileName: `${memberId}.pdf`, uploadedAt: '2026-10-19',
          url: `/tournaments/event-1/registrations/captain/payment-proofs/${memberId}`,
        })),
      }]);
      fixture.detectChanges();
      const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.proof-link');
      expect(links).toHaveLength(2);
      expect(links[1].href).toContain('/payment-proofs/partner');
      expect(fixture.nativeElement.textContent).toContain('Mark as paid');
    });

    it('does nothing when the payment confirmation is dismissed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      (fixture.componentInstance as any).markPaid(registration);
      http.expectNone(({ method }) => method === 'PATCH');
    });

    it('shows payment confirmation failures instead of changing the status', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      (fixture.componentInstance as any).markPaid(registration);
      http.expectOne(({ url }) => url.endsWith('/paid')).flush({ message: 'The registration changed.' }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('The registration changed.');
      expect((fixture.componentInstance as any).registrations()[0].status).toBe('Approved');
    });

    it('lets admins remove a paid registration after an explicit warning', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const paid = { ...registration, status: 'Paid' };
      (fixture.componentInstance as any).registrations.set([paid]);
      fixture.detectChanges();
      const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
        .find((item) => item.textContent?.includes('Remove registration'))!;
      button.click();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('PAID'));
      const request = http.expectOne(({ method }) => method === 'DELETE');
      expect(request.request.url).toContain('/admin/tournaments/event-1/registrations/captain');
      request.flush({ deleted: true });
      fixture.detectChanges();
      expect((fixture.componentInstance as any).registrations()).toEqual([]);
    });
  });
});