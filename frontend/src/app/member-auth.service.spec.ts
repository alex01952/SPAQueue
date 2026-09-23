import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemberAuthService } from './member-auth.service';

describe('MemberAuthService', () => {
  let auth: MemberAuthService;
  let http: HttpTestingController;
  const loginEmail = 'alex@example.com';
  const member = {
    memberId: 'member-1',
    name: 'Alex Member',
    age: 30,
    gender: 'Female',
    duprId: 'DUPR-123',
    reClubId: 'RECLUB-456',
    profileImageUrl: 'https://example.com/alex.jpg',
    skills: { serve: 8, dink: 7 },
    createdAt: '2026-04-12T08:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(MemberAuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should log in with credentials and retain the authenticated member', () => {
    auth.login(loginEmail, 'strong-password').subscribe((result) => {
      expect(result).toEqual(member);
      expect(auth.member()).toEqual(member);
    });

    const request = http.expectOne(({ url, method }) =>
      method === 'POST' && url.endsWith('/members/login'),
    );
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      email: loginEmail,
      password: 'strong-password',
    });
    request.flush({ authenticated: true, member });
  });

  it('should resolve an existing cookie session for the route guard', () => {
    auth.ensureAuthenticated().subscribe((authenticated) => {
      expect(authenticated).toBe(true);
    });

    const request = http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members/session'),
    );
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      authenticated: true,
      member,
    });
  });

  it('should refresh the member entity even when login data is cached', () => {
    auth.login(loginEmail, 'strong-password').subscribe();
    http.expectOne(({ url }) => url.endsWith('/members/login')).flush({
      authenticated: true,
      member,
    });

    auth.ensureAuthenticated().subscribe();

    const sessionRequest = http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members/session'),
    );
    sessionRequest.flush({
      authenticated: true,
      member: { ...member, gender: 'Prefer not to say' },
    });
    expect(auth.member()?.gender).toBe('Prefer not to say');
  });
});