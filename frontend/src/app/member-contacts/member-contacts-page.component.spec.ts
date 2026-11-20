import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MemberContactsPageComponent } from './member-contacts-page.component';

describe('MemberContactsPageComponent', () => {
  const members = [
    { memberId: 'one', name: 'Alice "A", Smith', reClubId: '=formula', profileImageUrl: '/alice.png', contactNo: '0123', email: 'alice@example.com', emergencyContact: '+63999' },
    { memberId: 'two', name: 'Bob', reClubId: 'Bob Club', profileImageUrl: '', contactNo: '0456', email: 'bob@example.com', emergencyContact: '0789' },
  ];
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:contacts');
  const revokeObjectURL = vi.fn();

  beforeEach(async () => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [MemberContactsPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('searches, selects results, opens a profile, and exports only selected contacts', async () => {
    const fixture = TestBed.createComponent(MemberContactsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectNone((req) => req.url.endsWith('/admin/member-contacts'));
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#contact-search')!;
    input.value = ' alice ';
    input.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const request = http.expectOne((req) => req.url.endsWith('/admin/member-contacts'));
    expect(request.request.params.get('search')).toBe('alice');
    expect(request.request.withCredentials).toBe(true);
    request.flush(members);
    fixture.detectChanges();
    expect(root.textContent).toContain('alice@example.com');
    expect(root.textContent).toContain('+63999');
    expect(root.querySelector<HTMLImageElement>('.profile img')?.getAttribute('src')).toBe('/alice.png');
    root.querySelector<HTMLButtonElement>('.profile')!.click();
    fixture.detectChanges();
    expect(root.querySelector('app-member-profile-frame iframe')?.getAttribute('src')).toBe('/member-profile/one?embedded=true');
    root.querySelector<HTMLButtonElement>('[aria-label="Close member profile"]')!.click();
    fixture.detectChanges();
    expect(root.querySelector('app-member-profile-frame')).toBeNull();

    const selectAll = root.querySelector<HTMLInputElement>('.actions input')!;
    selectAll.click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('.results input')).every((checkbox) => checkbox.checked)).toBe(true);
    selectAll.click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('.results input')).every((checkbox) => !checkbox.checked)).toBe(true);
    selectAll.click();
    fixture.detectChanges();
    root.querySelectorAll<HTMLInputElement>('.results input')[1].click();
    fixture.detectChanges();
    expect(selectAll.indeterminate).toBe(true);
    root.querySelector<HTMLButtonElement>('.actions button')!.click();
    const blob = createObjectURL.mock.calls[0][0];
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(csv).toContain('"Alice ""A"", Smith","\'=formula","0123","alice@example.com","\'+63999"');
    expect(csv).not.toContain('bob@example.com');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:contacts');

    input.value = 'Bob';
    input.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne((req) => req.params.get('search') === 'Bob').flush([members[1]]);
    fixture.detectChanges();
    const checkboxes = root.querySelectorAll<HTMLInputElement>('.results input');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('.actions button')!.disabled).toBe(false);
    checkboxes[1].click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.actions button')!.click();
    const secondCsv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(createObjectURL.mock.calls[1][0]);
    });
    expect(secondCsv).toContain('alice@example.com');
    expect(secondCsv).toContain('bob@example.com');
    http.verify();
  });

  it('retains selected contacts through empty or failed searches, deduplicates results and allows deselection', () => {
    const fixture = TestBed.createComponent(MemberContactsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#contact-search')!;
    const form = root.querySelector('form')!;
    const search = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    search('Alice');
    http.expectOne((req) => req.params.get('search') === 'Alice').flush([members[0]]);
    fixture.detectChanges();
    root.querySelector<HTMLInputElement>('.results input')!.click();
    fixture.detectChanges();
    search('missing');
    http.expectOne((req) => req.params.get('search') === 'missing').flush([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('No members match');
    expect(root.querySelector<HTMLInputElement>('.results input')!.checked).toBe(true);
    search('broken');
    http.expectOne((req) => req.params.get('search') === 'broken').flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(root.textContent).toContain('Unable to search');
    expect(root.querySelector<HTMLInputElement>('.results input')!.checked).toBe(true);
    search('Alice again');
    http.expectOne((req) => req.params.get('search') === 'Alice again').flush([{ ...members[0], email: 'new@example.com' }]);
    fixture.detectChanges();
    expect(root.querySelectorAll('.results article').length).toBe(1);
    expect(root.textContent).toContain('new@example.com');
    root.querySelector<HTMLInputElement>('.results input')!.click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('.results input')!.checked).toBe(false);
    search('missing');
    http.expectOne((req) => req.params.get('search') === 'missing').flush([]);
    fixture.detectChanges();
    expect(root.querySelector('.results')).toBeNull();
    http.verify();
  });

  it('shows empty search, no results and API errors without exposing stale results', () => {
    const fixture = TestBed.createComponent(MemberContactsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector('form')!;
    const input = root.querySelector<HTMLInputElement>('#contact-search')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(root.textContent).toContain('Enter a member name');
    input.value = 'unknown';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne((req) => req.params.get('search') === 'unknown').flush([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('No members match');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne((req) => req.params.get('search') === 'unknown').flush({}, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(root.textContent).toContain('Only admins');
    expect(root.textContent).not.toContain('No members match');
    http.verify();
  });

  it('cancels a previous search when another search is submitted', () => {
    const fixture = TestBed.createComponent(MemberContactsPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('#contact-search')!;
    const form = root.querySelector('form')!;
    input.value = 'Alice';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const oldRequest = http.expectOne((req) => req.params.get('search') === 'Alice');
    input.value = 'Bob';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(oldRequest.cancelled).toBe(true);
    http.expectOne((req) => req.params.get('search') === 'Bob').flush([members[1]]);
    fixture.detectChanges();
    expect(root.textContent).toContain('bob@example.com');
    expect(root.textContent).not.toContain('alice@example.com');
    http.verify();
  });
});
