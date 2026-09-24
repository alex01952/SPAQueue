import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import { VerifyEmailPageComponent } from './verify-email-page.component';

describe('VerifyEmailPageComponent', () => {
  it('should confirm the token from the secure link', async () => {
    const confirmEmailVerification = vi.fn(() => of({ verified: true as const }));
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
    expect(fixture.nativeElement.textContent).toContain(
      'Your email address has been verified.',
    );
  });
});