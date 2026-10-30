import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MembersPageComponent } from './members-page.component';

describe('MembersPageComponent', () => {
  it('should render the authenticated Azure Table directory response', async () => {
    await TestBed.configureTestingModule({
      imports: [MembersPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MembersPageComponent);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http.expectOne('/clubs/options').flush([]);

    const request = http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members'),
    );
    expect(request.request.withCredentials).toBe(true);
    request.flush([
      {
        memberId: 'jamie-member',
        name: 'Jamie Santos',
        role: 'Club Member',
        clubName: 'Sorsogon Pickleball Club',
        profileImageUrl: '',
        goldMembershipExpiresOn: '9999-12-31',
      },
      {
        memberId: 'zoe-member',
        name: 'Zoe Member',
        role: 'Arena Master',
        clubName: 'Sorsogon Pickleball Club',
        profileImageUrl: 'https://example.com/zoe.webp',
        goldMembershipExpiresOn: '2020-01-01',
      },
    ]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Jamie Santos');
    expect(compiled.textContent).toContain('Zoe Member');
    expect(compiled.textContent).toContain('Arena Master');
    expect(compiled.textContent).not.toContain('Alex Rivera');
    expect(compiled.querySelector('.member-initials')?.textContent).toContain('JS');
    expect(compiled.querySelectorAll('.member-icon')).toHaveLength(2);
    expect(compiled.querySelectorAll('.gold-member')).toHaveLength(1);
    expect(compiled.querySelector('.gold-member')?.textContent).toContain('Jamie Santos');
    expect(compiled.querySelector('.gold-badge')?.textContent).toBe('Gold member');
    expect(
      compiled.querySelector<HTMLAnchorElement>('.member-icon')?.getAttribute('href'),
    ).toBe('/member-profile/jamie-member');

    const search = compiled.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'Jamie';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.member-icon')).toHaveLength(1);
    expect(compiled.querySelector('.member-icon')?.classList.contains('gold-member')).toBe(true);
    search.value = 'Zoe';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.member-icon')).toHaveLength(1);
    expect(compiled.querySelector('.gold-member')).toBeNull();

    http.verify();
  });
});