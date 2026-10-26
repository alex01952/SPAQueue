import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthenticatedMember, MemberAuthService } from '../member-auth.service';
import { HomePageComponent } from '../home/home-page.component';
import { MemberBalancesPageComponent } from './member-balances-page.component';

describe('Balance staff page and reminders', () => {
  let fixture: ComponentFixture<MemberBalancesPageComponent>;
  let http: HttpTestingController;
  const actor = signal<AuthenticatedMember>({
    memberId: 'staff', name: 'Staff', role: 'balance-staff', age: 30, gender: 'Female',
    duprId: '', reClubId: '', skills: {}, profileImageUrl: '', createdAt: '', emailValidated: true,
  });
  const players = [
    { memberId: 'one', name: 'Player One', role: 'member', clubName: 'Club', profileImageUrl: '' },
    { memberId: 'two', name: 'Player Two', role: 'member', clubName: 'Club', profileImageUrl: '' },
  ];
  const balances = [{ balanceId: 'b1', memberId: 'one', balanceType: 'Open Play', balanceDate: '2026-10-22', amount: 100 }];

  beforeEach(async () => {
    actor.update((member) => ({ ...member, role: 'balance-staff' }));
    await TestBed.configureTestingModule({
      imports: [MemberBalancesPageComponent, HomePageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: MemberAuthService, useValue: { member: actor.asReadonly() } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MemberBalancesPageComponent);
    fixture.detectChanges();
    http.expectOne((item) => item.url.endsWith('/members')).flush(players);
    http.expectOne((item) => item.url.endsWith('/balance-types')).flush(['Open Play']);
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); http.verify(); vi.restoreAllMocks(); });
  const component = () => fixture.componentInstance;
  const text = () => (fixture.nativeElement as HTMLElement).textContent!;
  function selectPlayer(nextAllowedAt: string | null = null) {
    component()['selectMember'](players[0]);
    http.expectOne((item) => item.url.endsWith('/one/balances')).flush(balances);
    http.expectOne((item) => item.url.endsWith('/one/balance-reminder')).flush({ nextAllowedAt });
    fixture.detectChanges();
  }

  it('allows balance staff to manage balances but not grant roles', () => {
    selectPlayer();
    expect(text()).toContain('Add balance');
    expect(text()).toContain('Edit');
    expect(text()).toContain('Delete');
    expect(text()).not.toContain('Grant balance staff access');
    component()['setBalanceStaff'](true);
    http.expectNone((item) => item.url.endsWith('/role'));
    component()['balanceType'].set('Open Play');
    component()['balanceDate'].set('2026-10-22');
    component()['amount'].set(150);
    component()['saveBalance']();
    const create = http.expectOne((item) => item.method === 'POST' && item.url.endsWith('/one/balances'));
    expect(create.request.body).toEqual({ balanceType: 'Open Play', balanceDate: '2026-10-22', amount: 150 });
    create.flush({});
    http.expectOne((item) => item.url.endsWith('/one/balances')).flush(balances);
    component()['startEdit'](balances[0]);
    component()['saveBalance']();
    http.expectOne((item) => item.method === 'PATCH' && item.url.endsWith('/balances/b1')).flush({});
    http.expectOne((item) => item.url.endsWith('/one/balances')).flush(balances);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['deleteBalance'](balances[0]);
    component()['deleteBalance'](balances[0]);
    http.expectOne((item) => item.method === 'DELETE' && item.url.endsWith('/balances/b1')).flush({});
    http.expectOne((item) => item.url.endsWith('/one/balances')).flush([]);
  });

  it('lets only admins grant and revoke balance staff access with confirmation', () => {
    actor.update((member) => ({ ...member, role: 'admin' }));
    selectPlayer();
    expect(text()).toContain('Grant balance staff access');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['setBalanceStaff'](true);
    const request = http.expectOne((item) => item.url.endsWith('/one/role'));
    expect(request.request.body).toEqual({ role: 'balance-staff' });
    request.flush({ memberId: 'one', role: 'balance-staff' });
    fixture.detectChanges();
    expect(text()).toContain('Remove balance staff access');
    component()['setBalanceStaff'](false);
    const remove = http.expectOne((item) => item.url.endsWith('/one/role'));
    expect(remove.request.body).toEqual({ role: 'member' });
    remove.flush({ memberId: 'one', role: 'member' });
    expect(component()['selectedMember']()?.role).toBe('member');
  });

  it('sends one reminder with credentials and locks reminder/member actions until completion', () => {
    selectPlayer();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['remindMember']();
    component()['remindMember']();
    component()['selectMember'](players[1]);
    const request = http.expectOne((item) => item.method === 'POST' && item.url.endsWith('/one/balance-reminder'));
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({});
    expect(component()['selectedMember']()?.memberId).toBe('one');
    const nextAllowedAt = new Date(Date.now() + 86_400_000).toISOString();
    request.flush({ sent: true, nextAllowedAt });
    fixture.detectChanges();
    expect(text()).toContain('Balance reminder email sent.');
    expect(text()).toContain('Next reminder allowed:');
    component()['remindMember']();
    http.expectNone((item) => item.method === 'POST');
  });

  it('restores the shared cooldown and does not send when it is active or no balances are owed', () => {
    selectPlayer(new Date(Date.now() + 86_400_000).toISOString());
    component()['remindMember']();
    http.expectNone((item) => item.method === 'POST');
    component()['loadReminderStatus']('one');
    http.expectOne((item) => item.url.endsWith('/balance-reminder')).flush({ nextAllowedAt: new Date(Date.now() - 1000).toISOString() });
    expect(component()['reminderCoolingDown']()).toBe(false);
    component()['balances'].set([]);
    component()['remindMember']();
    http.expectNone((item) => item.method === 'POST');
  });

  it('requires confirmation and does not report failed email delivery as success', () => {
    selectPlayer();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component()['remindMember']();
    http.expectNone((item) => item.method === 'POST');
    confirm.mockReturnValue(true);
    component()['remindMember']();
    http.expectOne((item) => item.method === 'POST').flush(
      { message: 'Reminder delivery could not be confirmed' }, { status: 502, statusText: 'Bad Gateway' },
    );
    http.expectOne((item) => item.url.endsWith('/balance-reminder')).flush({ nextAllowedAt: new Date(Date.now() + 86_400_000).toISOString() });
    fixture.detectChanges();
    expect(text()).toContain('Reminder delivery could not be confirmed');
    expect(text()).not.toContain('Balance reminder email sent.');
    expect(component()['reminderCoolingDown']()).toBe(true);
  });

  it('never enables reminders if status cannot load and ignores stale results after switching members', () => {
    component()['selectMember'](players[0]);
    const oldBalances = http.expectOne((item) => item.url.endsWith('/one/balances'));
    const oldStatus = http.expectOne((item) => item.url.endsWith('/one/balance-reminder'));
    component()['selectMember'](players[1]);
    http.expectOne((item) => item.url.endsWith('/two/balances')).flush([]);
    http.expectOne((item) => item.url.endsWith('/two/balance-reminder')).flush(
      { message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' },
    );
    oldBalances.flush(balances);
    oldStatus.flush({ nextAllowedAt: null });
    expect(component()['balances']()).toEqual([]);
    expect(component()['reminderStatusLoaded']()).toBe(false);
    expect(component()['errorMessage']()).toBe('Storage unavailable');
    component()['remindMember']();
    http.expectNone((item) => item.method === 'POST');
  });

  it('shows balance navigation to staff but no other admin navigation', () => {
    const home = TestBed.createComponent(HomePageComponent);
    http.expectOne((item) => item.url.endsWith('/members/me/balances')).flush([]);
    home.detectChanges();
    const links = [...(home.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => link.getAttribute('href'));
    expect(links).toContain('/member-balances');
    for (const adminPage of ['/email-announcements', '/tournament-management', '/queue-dashboard', '/club-management', '/member-registration-approvals', '/open-play-participation/upload']) {
      expect(links).not.toContain(adminPage);
    }
    actor.update((member) => ({ ...member, role: 'member' }));
    home.detectChanges();
    expect(home.nativeElement.querySelector('a[href="/member-balances"]')).toBeNull();
    expect(home.nativeElement.querySelector('a[href="/email-announcements"]')).toBeNull();
    actor.update((member) => ({ ...member, role: 'admin' }));
    home.detectChanges();
    expect(home.nativeElement.querySelector('a[href="/email-announcements"]')).not.toBeNull();
    home.destroy();
  });
});
