import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import { VerifyEmailPageComponent } from './verify-email-page.component';

describe('VerifyEmailPageComponent', () => {
  it('should confirm the token from the secure link', async () => {
    const confirmEmailVerification = vi.fn(() => of({ verified: true as const, canLogin: true }));
    await TestBed.configureTestingModule({
      imports: [VerifyEmailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ token: 'secure-token' }) },
          },
        },
        {
          provide: MemberAuthService,
          useValue: { confirmEmailVerification },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyEmailPageComponent);
    fixture.detectChanges();

    expect(confirmEmailVerification).toHaveBeenCalledWith('secure-token');
    expect(fixture.nativeElement.textContent).toContain('Email verified');
    expect(fixture.nativeElement.textContent).toContain('You can now log in.');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/login');
  });

  it('does not tell an existing pending member they can log in', async () => {
    await TestBed.configureTestingModule({
      imports: [VerifyEmailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { queryParamMap: convertToParamMap({ token: 'secure-token' }) },
        } },
        { provide: MemberAuthService, useValue: {
          confirmEmailVerification: () => of({ verified: true, canLogin: false }),
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VerifyEmailPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('your account is not approved');
    expect(fixture.nativeElement.textContent).not.toContain('You can now log in.');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/');
  });

  it('does not misreport a server error as an expired link', async () => {
    await TestBed.configureTestingModule({
      imports: [VerifyEmailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { queryParamMap: convertToParamMap({ token: 'secure-token' }) },
        } },
        { provide: MemberAuthService, useValue: {
          confirmEmailVerification: () => throwError(() => new HttpErrorResponse({ status: 502 })),
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VerifyEmailPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your email could not be verified.');
    expect(fixture.nativeElement.textContent).not.toContain('has expired');
  });
});
