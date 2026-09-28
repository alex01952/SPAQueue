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

    const approveButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
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
});
