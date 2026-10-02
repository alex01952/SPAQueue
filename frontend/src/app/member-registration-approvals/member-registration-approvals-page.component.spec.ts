import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemberRegistrationApprovalsPageComponent } from './member-registration-approvals-page.component';

describe('MemberRegistrationApprovalsPageComponent', () => {
  it('should load and approve an email-verified registration', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRegistrationApprovalsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberRegistrationApprovalsPageComponent);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http
      .expectOne(
        ({ url, method }) =>
          method === 'GET' && url.endsWith('/admin/member-registrations/pending'),
      )
      .flush([
        {
          memberId: 'member-1',
          name: 'Alex Member',
          email: 'alex@example.com',
          createdAt: '2026-09-28T00:00:00.000Z',
          emailValidated: true,
        },
      ]);
    fixture.detectChanges();

    const approveButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Approve') as HTMLButtonElement;
    approveButton.click();
    http
      .expectOne(
        ({ url, method }) =>
          method === 'PATCH' && url.endsWith('/admin/member-registrations/member-1/approve'),
      )
      .flush({ memberId: 'member-1', status: 'Approved' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Alex Member's registration was approved.");
    expect(fixture.nativeElement.textContent).toContain('No registrations are awaiting approval.');
    http.verify();
  });

  it('opens the selected registration profile in the iframe window', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRegistrationApprovalsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberRegistrationApprovalsPageComponent);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http.expectOne(({ url }) => url.endsWith('/admin/member-registrations/pending')).flush([
      {
        memberId: 'member-42',
        name: 'Casey Member',
        email: 'casey@example.com',
        createdAt: '2026-09-28T00:00:00.000Z',
        emailValidated: true,
      },
    ]);
    fixture.detectChanges();

    const profileButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'View profile') as HTMLButtonElement;
    profileButton.click();
    fixture.detectChanges();

    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('/member-profile/member-42');
    expect(iframe.getAttribute('title')).toBe('Casey Member member profile');
    http.verify();
  });
});
