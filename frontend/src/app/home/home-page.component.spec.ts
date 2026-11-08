import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthenticatedMember, MemberAuthService } from '../member-auth.service';
import { HomePageComponent } from './home-page.component';

describe('HomePageComponent', () => {
  let fixture: ComponentFixture<HomePageComponent>;
  let router: Router;
  const logout = vi.fn(() => of(undefined));
  const requestEmailVerification = vi.fn(() =>
    of({ sent: true as const, email: 'al**@example.com' }),
  );
  const member = signal<AuthenticatedMember>({
    memberId: 'member-1',
    name: 'Alex Member',
    age: 30,
    gender: 'Female',
    duprId: '',
    reClubId: '',
    profileImageUrl: '',
    skills: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    emailValidated: false,
  });

  beforeEach(async () => {
    logout.mockClear();
    requestEmailVerification.mockClear();
    member.update((value) => ({ ...value, role: 'member', emailValidated: false }));
    await TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MemberAuthService,
          useValue: {
            member: member.asReadonly(),
            logout,
            requestEmailVerification,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePageComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(
      (request) => request.url.endsWith('/members/me/balances'),
    ).flush([]);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('should expose every requested member destination', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const menuText = Array.from(compiled.querySelectorAll('.menu-item strong')).map(
      (element) => element.textContent?.trim(),
    );
    const routes = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.menu-item[href]')).map(
      (element) => element.getAttribute('href'),
    );

    expect(menuText).toEqual([
      'Profile',
      'Members',
      'Clubs',
      'Masters of the Arena',
      'Tournaments',
      'Player validations',
      'Open Play board',
      'My balances',
      'My points & rewards',
      'Logout',
    ]);
    expect(routes).toEqual([
      '/member-profile',
      '/members',
      '/clubs',
      '/masters-of-the-arena',
      '/tournaments',
      '/club-player-validations',
      '/open-play-board',
      '/my-balances',
      '/my-rewards',
    ]);
  });

  it('groups admin-only destinations under one Admin link while preserving shared staff tools', () => {
    member.update((value) => ({ ...value, role: 'admin' }));
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.home-menu a'));
    const hrefs = links.map((link) => link.getAttribute('href'));

    expect(links.find((link) => link.getAttribute('href') === '/admin')?.textContent).toContain('Admin');
    expect(hrefs).toContain('/member-points');
    expect(hrefs).toContain('/member-balances');
    for (const route of [
      '/store-admin', '/email-announcements', '/queue-dashboard',
      '/open-play-participation/upload', '/member-registration-approvals',
      '/club-management', '/tournament-management',
    ]) {
      expect(hrefs).not.toContain(route);
    }
    expect(Array.from(compiled.querySelectorAll('.menu-index')).map(
      (item) => item.textContent?.trim(),
    )).toEqual(Array.from({ length: 13 }, (_, index) => String(index + 1).padStart(2, '0')));
  });

  it.each(['member', 'club-owner', 'balance-staff'] as const)(
    'does not show Admin for %s accounts',
    (role) => {
      member.update((value) => ({ ...value, role }));
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('a[href="/admin"]')).toBeNull();
      expect(!!compiled.querySelector('a[href="/open-play-matching"]')).toBe(role === 'balance-staff');
      expect(!!compiled.querySelector('a[href="/member-points"]')).toBe(role === 'balance-staff');
      expect(!!compiled.querySelector('a[href="/member-balances"]')).toBe(role === 'balance-staff');
    },
  );

  it('should end the session and return to login', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const logoutButton = fixture.nativeElement.querySelector(
      '.logout-item',
    ) as HTMLButtonElement;

    logoutButton.click();

    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('should request email verification and show the masked recipient', () => {
    const button = fixture.nativeElement.querySelector(
      '.email-verification button',
    ) as HTMLButtonElement;

    button.click();
    fixture.detectChanges();

    expect(requestEmailVerification).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Verification email sent to al**@example.com',
    );
  });
});