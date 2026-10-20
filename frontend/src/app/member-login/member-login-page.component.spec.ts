import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';
import { MemberLoginPageComponent } from './member-login-page.component';

describe('MemberLoginPageComponent', () => {
  async function configure() {
    await TestBed.configureTestingModule({
      imports: [MemberLoginPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: MemberAuthService,
          useValue: { login: vi.fn() },
        },
      ],
    }).compileComponents();

    return {
      fixture: TestBed.createComponent(MemberLoginPageComponent),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('resends verification to a pending registrant from the login page', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    fixture.componentInstance['email'] = 'pending@example.com';

    fixture.componentInstance['resendVerificationEmail']();
    const request = http.expectOne('/members/email-verification/resend');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'pending@example.com' });
    expect(request.request.withCredentials).toBe(true);
    request.flush({ sent: true, email: 'pe*****@example.com' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'A new verification link was sent to pe*****@example.com.',
    );
    http.verify();
  });

  it('requires an email before requesting a replacement verification link', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();

    fixture.componentInstance['resendVerificationEmail']();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Enter your registration email address',
    );
    http.expectNone('/members/email-verification/resend');
    http.verify();
  });
});
