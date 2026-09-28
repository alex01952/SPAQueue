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
      emergencyContact: '09987654321',
      age: 30,
      gender: 'Female',
      duprId: 'DUPR-1',
      reClubId: 'RECLUB-1',
      profileImageUrl: '',
      skills: { serve: 7 },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    fixture.detectChanges();

    const profile = (fixture.componentInstance as any).profile;
    expect(profile.contactNo).toBe('9123456789');
    expect(profile.emergencyContact).toBe('9987654321');

    const emailInput = fixture.nativeElement.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    expect(emailInput.value).toBe('fixed@example.com');
    expect(emailInput.readOnly).toBe(true);

    profile.name = 'Updated Member';
    (fixture.componentInstance as any).saveProfile();

    const updateRequest = http.expectOne(({ url, method }) =>
      method === 'PATCH' && url.endsWith('/members/me'),
    );
    expect(updateRequest.request.withCredentials).toBe(true);
    const updateBody = updateRequest.request.body as FormData;
    expect(updateBody.get('name')).toBe('Updated Member');
    expect(updateBody.get('contactNo')).toBe('+639123456789');
    expect(updateBody.get('emergencyContact')).toBe('+639987654321');
    expect(updateBody.has('email')).toBe(false);
    updateRequest.flush({
      memberId: 'current-member',
      email: 'fixed@example.com',
      name: 'Updated Member',
      contactNo: '09123456789',
      emergencyContact: '+639987654321',
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

  it('blocks saving an invalid mobile number', async () => {
    await TestBed.configureTestingModule({
      imports: [EditProfilePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MemberAuthService, useValue: { updateAuthenticatedMember: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EditProfilePageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(({ url }) => url.endsWith('/members/me')).flush({
      email: 'member@example.com', name: 'Member', contactNo: '+639123456789',
      emergencyContact: '+639987654321', gender: 'Female', skills: {},
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const emergencyContactInput = fixture.nativeElement.querySelector('input[name="emergencyContact"]') as HTMLInputElement;
    emergencyContactInput.value = '12345';
    emergencyContactInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).profile.emergencyContact).toBe('12345');
    expect((fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

    (fixture.componentInstance as any).saveProfile();
    http.expectNone(({ method }) => method === 'PATCH');
    expect(fixture.componentInstance['errorMessage']()).toContain('10 digits starting with 9');
    http.verify();
  });
});