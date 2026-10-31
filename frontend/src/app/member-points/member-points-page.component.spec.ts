import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MemberPointsPageComponent } from './member-points-page.component';
import { routes } from '../app.routes';
import { HomePageComponent } from '../home/home-page.component';
import { MemberAuthService, MemberRole } from '../member-auth.service';

describe('MemberPointsPageComponent', () => {
  const member = { memberId: 'player', name: 'Gold Player', goldMembershipExpiresOn: '9999-12-31' };
  const blankHistory = { balance: 0, awards: [], continuationToken: null };
  const recorded = {
    awardId: 'award:1', source: 'OpenPlayParticipation', activityDate: '2026-10-30',
    points: 10, scheduleName: 'Morning', startHour: null, courtNumber: null,
    reason: '', createdByName: 'Staff', createdAt: '2026-10-31T02:00:00Z',
  };
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [MemberPointsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberPointsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/members').flush([member, { memberId: 'regular', name: 'Regular Player' }]);
    http.expectOne('/member-points/config').flush({ openPlayPoints: 10, courtRentalPoints: 5 });
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance };
  }

  it('restricts the route to admins and balance-staff', () => {
    expect(routes.find((route) => route.path === 'member-points')?.data?.['allowedRoles'])
      .toEqual(['admin', 'balance-staff']);
  });

  describe('Member points navigation', () => {
    it.each<MemberRole>(['admin', 'balance-staff', 'member', 'club-owner'])('shows the points link only to authorized staff (%s)', async (role) => {
      const member = signal({ memberId: 'actor', name: 'Actor', role, emailValidated: true });
      await TestBed.configureTestingModule({
        imports: [HomePageComponent],
        providers: [
          provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
          { provide: MemberAuthService, useValue: { member: member.asReadonly() } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(HomePageComponent);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/members/me/balances').flush([]);
      fixture.detectChanges();
      const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/member-points"]');
      expect(!!link).toBe(role === 'admin' || role === 'balance-staff');
      http.verify();
    });
  });

  it('loads settings, selects a member and shows point totals and audited history', async () => {
    const { fixture, http, component } = await setup();
    component['selectMember']('player');
    const request = http.expectOne('/member-points/player');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ balance: 10, awards: [recorded], continuationToken: null });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Total points: 10');
    expect(element.textContent).toContain('Morning');
    expect(element.textContent).toContain('Staff');
    expect(element.textContent).toContain('Points: 10');
    http.verify();
  });

  it('submits the activity without a client-selected standard amount, then refreshes history', async () => {
    const { fixture, http, component } = await setup();
    component['selectMember']('player');
    http.expectOne('/member-points/player').flush(blankHistory);
    component['form'].scheduleName = 'Morning';
    component['form'].activityDate = '2026-10-30';
    component['save']();
    component['save']();
    const request = http.expectOne('/member-points/player');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      requestId: expect.any(String), source: 'OpenPlayParticipation',
      activityDate: '2026-10-30', scheduleName: 'Morning',
    });
    request.flush(recorded);
    http.expectOne('/member-points/player').flush({ balance: 10, awards: [recorded], continuationToken: null });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('10 points awarded.');
    http.verify();
  });

  it('sends hourly slots and court numbers for rentals, and custom amounts with reasons', async () => {
    const { http, component } = await setup();
    component['selectMember']('player');
    http.expectOne('/member-points/player').flush(blankHistory);
    component['form'].source = 'CourtRental';
    component['form'].startHour = 16;
    component['form'].courtNumber = 2;
    component['save']();
    const rental = http.expectOne('/member-points/player');
    expect(rental.request.body).toMatchObject({ source: 'CourtRental', startHour: 16, courtNumber: 2 });
    expect(rental.request.body.points).toBeUndefined();
    rental.flush({ ...recorded, points: 5 });
    http.expectOne('/member-points/player').flush(blankHistory);
    component['form'].source = 'CustomAward';
    component['form'].points = 12;
    component['form'].reason = 'Volunteer recognition';
    component['save']();
    const custom = http.expectOne('/member-points/player');
    expect(custom.request.body).toMatchObject({ source: 'CustomAward', points: 12, reason: 'Volunteer recognition' });
    expect(custom.request.body.scheduleName).toBeUndefined();
    custom.flush({ ...recorded, points: 12 });
    http.expectOne('/member-points/player').flush(blankHistory);
    http.verify();
  });

  it('reuses the request ID after an uncertain error and prevents changing members or details', async () => {
    const { http, component } = await setup();
    component['selectMember']('player');
    http.expectOne('/member-points/player').flush(blankHistory);
    component['form'].source = 'CustomAward';
    component['form'].points = 12;
    component['form'].reason = 'Recognition';
    component['save']();
    const first = http.expectOne('/member-points/player');
    const requestId = first.request.body.requestId;
    first.flush({ message: 'Storage error' }, { status: 502, statusText: 'Bad Gateway' });
    expect(component['error']()).toContain('may have been recorded');
    component['selectMember']('regular');
    expect(component['selected']()?.memberId).toBe('player');
    component['form'].points = 13;
    component['save']();
    http.expectNone('/member-points/player');
    component['form'].points = 12;
    component['save']();
    const retry = http.expectOne('/member-points/player');
    expect(retry.request.body.requestId).toBe(requestId);
    retry.flush({ ...recorded, points: 12 });
    http.expectOne('/member-points/player').flush(blankHistory);
    http.verify();
  });

  it('shows duplicate errors and does not change totals', async () => {
    const { http, component } = await setup();
    component['selectMember']('player');
    http.expectOne('/member-points/player').flush({ ...blankHistory, balance: 10 });
    component['form'].scheduleName = 'Morning';
    component['save']();
    http.expectOne('/member-points/player').flush({
      message: 'Points have already been awarded to this member for that activity.',
    }, { status: 409, statusText: 'Conflict' });
    expect(component['error']()).toContain('already been awarded');
    expect(component['history']()?.balance).toBe(10);
    expect(component['saving']()).toBe(false);
    http.verify();
  });

  it('permits viewing history but blocks awards for non-Gold members', async () => {
    const { fixture, http, component } = await setup();
    component['selectMember']('regular');
    http.expectOne('/member-points/regular').flush(blankHistory);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
    component['save']();
    expect(component['error']()).toContain('active Gold membership');
    http.verify();
  });

  it('loads more history with a continuation token and ignores stale member history responses', async () => {
    const { http, component } = await setup();
    component['selectMember']('player');
    const old = http.expectOne('/member-points/player');
    component['selectMember']('regular');
    http.expectOne('/member-points/regular').flush({ balance: 4, awards: [], continuationToken: 'next' });
    old.flush({ balance: 99, awards: [recorded], continuationToken: null });
    expect(component['history']()?.balance).toBe(4);
    component['loadHistory'](true);
    const more = http.expectOne((request) => request.params.get('continuation') === 'next');
    more.flush({ balance: 4, awards: [recorded], continuationToken: null });
    expect(component['history']()?.awards).toHaveLength(1);
    http.verify();
  });

  it('reports load failures and allows retrying', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberPointsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberPointsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/members').flush([]);
    http.expectOne('/member-points/config').flush({ message: 'Configuration invalid' }, { status: 400, statusText: 'Bad Request' });
    expect(fixture.componentInstance['error']()).toBe('Configuration invalid');
    fixture.componentInstance['load']();
    http.expectOne('/members').flush([]);
    http.expectOne('/member-points/config').flush({ openPlayPoints: null, courtRentalPoints: null });
    expect(fixture.componentInstance['error']()).toBe('');
    http.verify();
  });
});
