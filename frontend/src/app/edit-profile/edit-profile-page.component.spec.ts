import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';
import { EditProfilePageComponent } from './edit-profile-page.component';

describe('EditProfilePageComponent', () => {
  it('should display immutable email and exclude it from updates', async () => {
    const updateAuthenticatedMember = vi.fn();
    await TestBed.configureTestingModule({
      imports: [EditProfilePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: MemberAuthService,
          useValue: { updateAuthenticatedMember },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EditProfilePageComponent);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members/me'),
    ).flush({
      memberId: 'current-member',
      email: 'fixed@example.com',
      name: 'Current Member',
      contactNo: '09123456789',
      emergencyContact: 'Emergency Contact',
      age: 30,
      gender: 'Female',
      duprId: 'DUPR-1',
      reClubId: 'RECLUB-1',
      profileImageUrl: '',
      skills: { serve: 7 },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    fixture.detectChanges();

    const emailInput = fixture.nativeElement.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    expect(emailInput.value).toBe('fixed@example.com');
    expect(emailInput.readOnly).toBe(true);

    (fixture.componentInstance as any).profile.name = 'Updated Member';
    (fixture.componentInstance as any).saveProfile();

    const updateRequest = http.expectOne(({ url, method }) =>
      method === 'PATCH' && url.endsWith('/members/me'),
    );
    expect(updateRequest.request.withCredentials).toBe(true);
    const updateBody = updateRequest.request.body as FormData;
    expect(updateBody.get('name')).toBe('Updated Member');
    expect(updateBody.has('email')).toBe(false);
    updateRequest.flush({
      memberId: 'current-member',
      email: 'fixed@example.com',
      name: 'Updated Member',
      contactNo: '09123456789',
      emergencyContact: 'Emergency Contact',
      age: 30,
      gender: 'Female',
      duprId: 'DUPR-1',
      reClubId: 'RECLUB-1',
      profileImageUrl: '',
      skills: { serve: 7 },
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(updateAuthenticatedMember).toHaveBeenCalled();
    expect(fixture.componentInstance['successMessage']()).toBe(
      'Profile changes saved.',
    );
    http.verify();
  });
});