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
      },
      {
        memberId: 'zoe-member',
        name: 'Zoe Member',
        role: 'Arena Master',
        clubName: 'Sorsogon Pickleball Club',
        profileImageUrl: 'https://example.com/zoe.webp',
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
    expect(
      compiled.querySelector<HTMLAnchorElement>('.member-icon')?.getAttribute('href'),
    ).toBe('/member-profile/jamie-member');

    http.verify();
  });
});