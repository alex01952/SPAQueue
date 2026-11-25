import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MemberAuthService } from '../member-auth.service';
import { routes } from '../app.routes';
import { GoldMembershipPageComponent } from './gold-membership-page.component';

describe('Gold membership pages', () => {
  const application = {
    id: '12345678-1234-4234-8234-123456789abc', memberId: 'player', name: 'Player One', reClubId: 'Ace',
    status: 'Pending', submittedAt: '2026-11-25T08:00:00Z', reviewedAt: null,
    declineReason: '', expiresOn: null, paymentMethod: 'receipt', receiptFileName: 'receipt.pdf',
  };
  const initialState = { activeGold: false, goldMembershipExpiresOn: null, documentAvailable: true, application: null };
  let adminPage: boolean;

  beforeEach(() => { adminPage = false; });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  function createPage() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { adminApplications: adminPage } } } },
        { provide: MemberAuthService, useValue: { member: signal(null), updateAuthenticatedMember: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(GoldMembershipPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flushLoad(state: object = initialState, applications: object[] = []) {
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/gold-membership').flush(state);
    if (adminPage) http.expectOne('/gold-membership/applications?status=Pending').flush(applications);
  }

  function selectFile(input: HTMLInputElement, name = 'receipt.pdf') {
    const file = new File(['%PDF-1.7\nreceipt'], name, { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
  }

  it('submits a member receipt with credentials and then shows pending status instead of another signup form', () => {
    const fixture = createPage();
    flushLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href="/gold-membership/document"]')).not.toBeNull();
    selectFile(element.querySelector('input[type=file]')!);
    fixture.detectChanges();
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Submit application'))!;
    button.click();
    const request = TestBed.inject(HttpTestingController).expectOne('/gold-membership/applications');
    expect(request.request.withCredentials).toBe(true);
    const form = request.request.body as FormData;
    expect(form.get('receipt')).toBeInstanceOf(File);
    expect(form.get('paymentMethod')).toBe('receipt');
    expect(form.get('requestId')).toMatch(/^[a-f0-9-]{36}$/);
    request.flush(application);
    flushLoad({ ...initialState, application });
    fixture.detectChanges();
    expect(element.textContent).toContain('awaiting admin review');
    expect(element.querySelector('input[type=file]')).toBeNull();
    expect(element.querySelector('a[href*="/receipt"]')).not.toBeNull();
  });

  it('submits a counter payment without a receipt, even after previously selecting a file', () => {
    const fixture = createPage();
    flushLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    selectFile(element.querySelector('input[type=file]')!);
    element.querySelector<HTMLInputElement>('input[value="arena-counter"]')!.click();
    fixture.detectChanges();
    expect(element.querySelector('input[type=file]')).toBeNull();
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Submit application'))!;
    expect(button.disabled).toBe(false);
    button.click();
    const request = TestBed.inject(HttpTestingController).expectOne('/gold-membership/applications');
    const form = request.request.body as FormData;
    expect(form.get('paymentMethod')).toBe('arena-counter');
    expect(form.has('receipt')).toBe(false);
    const counterApplication = { ...application, paymentMethod: 'arena-counter', receiptFileName: null };
    request.flush(counterApplication);
    flushLoad({ ...initialState, application: counterApplication });
    fixture.detectChanges();
    expect(element.textContent).toContain('Paid at arena counter');
    expect(element.textContent).toContain('awaiting admin review');
    expect(element.querySelector('a[href*="/receipt"]')).toBeNull();
  });

  it('identifies counter payments to admins without a receipt link and asks them to verify payment', () => {
    adminPage = true;
    const fixture = createPage();
    flushLoad(initialState, [{ ...application, paymentMethod: 'arena-counter', receiptFileName: null }]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Paid at arena counter');
    expect(element.querySelector('a[href*="/receipt"]')).toBeNull();
    [...element.querySelectorAll('button')].find((item) => item.textContent === 'Approve')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Verify their arena counter payment before approving.');
    TestBed.inject(HttpTestingController).expectNone((request) => request.method === 'PATCH');
  });

  it('blocks signup without the benefits document or with active Gold membership, and shows decline reasons', () => {
    const fixture = createPage();
    flushLoad({ ...initialState, documentAvailable: false, application: { ...application, status: 'Declined', declineReason: 'Unreadable receipt' } });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Unreadable receipt');
    expect(element.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(true);
    const refresh = [...element.querySelectorAll('button')].find((item) => item.textContent === 'Refresh')!;
    refresh.click();
    flushLoad({ ...initialState, activeGold: true, goldMembershipExpiresOn: '2027-11-25' });
    fixture.detectChanges();
    expect(element.textContent).toContain('You are a Gold member');
    expect(element.querySelector('input[type=file]')).toBeNull();
  });

  it('retains the request ID after an uncertain submission failure so a retry cannot create a duplicate', () => {
    const fixture = createPage();
    flushLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    selectFile(element.querySelector('input[type=file]')!);
    fixture.detectChanges();
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Submit application'))!;
    button.click();
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/gold-membership/applications');
    const firstId = (first.request.body as FormData).get('requestId');
    first.flush({ message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(element.textContent).toContain('Storage unavailable');
    button.click();
    const second = http.expectOne('/gold-membership/applications');
    expect((second.request.body as FormData).get('requestId')).toBe(firstId);
    second.flush(application);
    flushLoad({ ...initialState, application });
  });

  it('requires confirmation before admin approval and supports uploading the benefits PDF', () => {
    adminPage = true;
    const fixture = createPage();
    flushLoad(initialState, [application]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const approve = [...element.querySelectorAll('button')].find((item) => item.textContent === 'Approve')!;
    approve.click();
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectNone((request) => request.method === 'PATCH');
    expect(element.textContent).toContain('one year of Gold membership');
    const confirm = [...element.querySelectorAll('button')].find((item) => item.textContent === 'Confirm approval')!;
    confirm.click();
    const review = http.expectOne(`/gold-membership/applications/player/${application.id}/approve`);
    expect(review.request.withCredentials).toBe(true);
    review.flush({ ...application, status: 'Approved', expiresOn: '2027-11-25' });
    flushLoad();
    fixture.detectChanges();
    expect(element.textContent).toContain('Gold membership expires on 2027-11-25');
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
    selectFile(input, 'benefits.pdf');
    fixture.detectChanges();
    [...element.querySelectorAll('button')].find((item) => item.textContent === 'Upload document')!.click();
    const upload = http.expectOne('/gold-membership/document');
    expect(upload.request.method).toBe('PUT');
    expect((upload.request.body as FormData).get('document')).toBeInstanceOf(File);
    upload.flush({ documentAvailable: true });
    flushLoad();
    expect(routes.find((route) => route.path === 'gold-membership-applications')?.data?.['allowedRoles']).toEqual(['admin']);
  });

  it('requires a decline reason and sends it to the admin endpoint', () => {
    adminPage = true;
    const fixture = createPage();
    flushLoad(initialState, [application]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    [...element.querySelectorAll('button')].find((item) => item.textContent === 'Decline')!.click();
    fixture.detectChanges();
    [...element.querySelectorAll('button')].find((item) => item.textContent === 'Confirm decline')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Enter a decline reason');
    const input = element.querySelector('textarea')!;
    input.value = 'Receipt is unreadable';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    [...element.querySelectorAll('button')].find((item) => item.textContent === 'Confirm decline')!.click();
    const request = TestBed.inject(HttpTestingController).expectOne(`/gold-membership/applications/player/${application.id}/decline`);
    expect(request.request.body).toEqual({ reason: 'Receipt is unreadable' });
    request.flush({ ...application, status: 'Declined' });
    flushLoad();
  });
});
