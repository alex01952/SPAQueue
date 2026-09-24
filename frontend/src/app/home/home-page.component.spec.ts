import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import { HomePageComponent } from './home-page.component';

describe('HomePageComponent', () => {
  let fixture: ComponentFixture<HomePageComponent>;
  let router: Router;
  const logout = vi.fn(() => of(undefined));
  const requestEmailVerification = vi.fn(() =>
    of({ sent: true as const, email: 'al**@example.com' }),
  );
  const member = signal({
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
    await TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideRouter([]),
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
  });

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
      'Queueing',
      'Logout',
    ]);
    expect(routes).toEqual([
      '/member-profile',
      '/members',
      '/clubs',
      '/masters-of-the-arena',
      '/queue-dashboard',
    ]);
  });

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