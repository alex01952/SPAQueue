import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import { MemberProfilePageComponent } from './member-profile-page.component';

describe('MemberProfilePageComponent', () => {
  const currentMember = {
    memberId: 'current-member',
    name: 'Current Member',
    age: 30,
    gender: 'Female',
    duprId: 'CURRENT-DUPR',
    reClubId: 'CURRENT-RECLUB',
    profileImageUrl: '',
    skills: { serve: 5 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  async function configure(memberId?: string) {
    const member = signal(currentMember);
    await TestBed.configureTestingModule({
      imports: [MemberProfilePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap(memberId ? { memberId } : {})),
          },
        },
        {
          provide: MemberAuthService,
          useValue: { member: member.asReadonly() },
        },
      ],
    }).compileComponents();

    return {
      fixture: TestBed.createComponent(MemberProfilePageComponent),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('should render the authenticated member on the unparameterized route', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Current Member');
    expect(text).toContain('CURRENT-DUPR');
    http.expectNone(({ url }) => /\/members\/[^/]+$/.test(url));
    http.verify();
  });

  it('should request and render the member identified by the route row key', async () => {
    const { fixture, http } = await configure('selected-member-row-key');
    fixture.detectChanges();

    const request = http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members/selected-member-row-key'),
    );
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      memberId: 'selected-member-row-key',
      name: 'Selected Member',
      age: 29,
      gender: 'Non-binary',
      duprId: 'SELECTED-DUPR',
      reClubId: 'SELECTED-RECLUB',
      profileImageUrl: '',
      skills: { courtAwareness: 7 },
      createdAt: '2026-02-18T09:30:00.000Z',
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Selected Member');
    expect(text).toContain('SELECTED-DUPR');
    expect(text).toContain('Court Awareness');
    expect(text).not.toContain('Current Member');
    expect(text).not.toContain('CURRENT-DUPR');
    http.verify();
  });
});