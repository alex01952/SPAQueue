import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClubPlayerValidationsPageComponent } from './club-player-validations-page.component';
import { MemberAuthService } from './member-auth.service';

describe('ClubPlayerValidationsPageComponent', () => {
  async function configure() {
    await TestBed.configureTestingModule({
      imports: [ClubPlayerValidationsPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MemberAuthService,
          useValue: { member: () => null },
        },
      ],
    }).compileComponents();

    return {
      fixture: TestBed.createComponent(ClubPlayerValidationsPageComponent),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('loads officer clubs and their members', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();

    const clubs = http.expectOne('/clubs/me/officer-memberships');
    expect(clubs.request.withCredentials).toBe(true);
    clubs.flush([{ clubId: 'club-1', name: 'Sorsogon Pickleball' }]);

    const members = http.expectOne(
      '/clubs/club-1/members/profile-validations',
    );
    expect(members.request.withCredentials).toBe(true);
    members.flush([
      {
        memberId: 'player-1',
        name: 'Player One',
        profileImageUrl: '',
        validations: [],
      },
    ]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Player One',
    );

    (fixture.nativeElement.querySelector('.profile-link') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-member-profile-frame')).not.toBeNull();
    http.verify();
  });

  it('validates a selected club member and refreshes the member list', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    http
      .expectOne('/clubs/me/officer-memberships')
      .flush([{ clubId: 'club-1', name: 'Sorsogon Pickleball' }]);
    http
      .expectOne('/clubs/club-1/members/profile-validations')
      .flush([
        {
          memberId: 'player-1',
          name: 'Player One',
          profileImageUrl: '',
          validations: [],
        },
      ]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.member-row > button',
    ) as HTMLButtonElement;
    button.click();

    const validation = http.expectOne(
      '/clubs/club-1/members/player-1/profile-validations',
    );
    expect(validation.request.method).toBe('POST');
    expect(validation.request.withCredentials).toBe(true);
    validation.flush({
      officerName: 'Officer Alex',
      clubName: 'Sorsogon Pickleball',
      validatedAt: '2026-10-20T03:00:00.000Z',
    });
    http
      .expectOne('/clubs/club-1/members/profile-validations')
      .flush([]);

    http.verify();
  });
});
