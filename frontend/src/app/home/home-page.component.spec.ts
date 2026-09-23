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
  const member = signal({
    memberId: 'member-1',
    email: 'alex@example.com',
    name: 'Alex Member',
    profileImageUrl: '',
  });

  beforeEach(async () => {
    logout.mockClear();
    await TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: MemberAuthService,
          useValue: { member: member.asReadonly(), logout },
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
});