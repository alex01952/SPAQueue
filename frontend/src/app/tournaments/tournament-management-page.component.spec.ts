import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TournamentManagementPageComponent } from './tournament-management-page.component';

describe('TournamentManagementPageComponent terms upload', () => {
  let fixture: ComponentFixture<TournamentManagementPageComponent>;
  const http = {
    get: vi.fn(() => of([])),
    post: vi.fn((_url: string, _body: unknown, _options: unknown) => of({})),
  };

  beforeEach(async () => {
    http.get.mockClear();
    http.post.mockReset().mockReturnValue(of({}));
    await TestBed.configureTestingModule({
      imports: [TournamentManagementPageComponent],
      providers: [provideRouter([]), { provide: HttpClient, useValue: http }],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentManagementPageComponent);
    fixture.detectChanges();
  });

  function selectFile(file: File): HTMLInputElement {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return input;
  }

  it('submits a selected PDF with the tournament fields and clears selection after success', () => {
    const file = new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' });
    const input = selectFile(file);
    const component = fixture.componentInstance as any;
    component.form.name = 'Club Open';
    component.createTournament(input);
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/admin/tournaments'),
      expect.any(FormData), { withCredentials: true });
    const body = http.post.mock.calls[0][1] as FormData;
    expect(body.get('termsFile')).toBe(file);
    expect(body.get('name')).toBe('Club Open');
    expect(body.get('maxSlots')).toBe('16');
    expect(component.termsFile()).toBeNull();
    expect(input.value).toBe('');
    expect(component.feedbackMessage()).toBe('Tournament created.');
  });

  it('allows creation without a document', () => {
    const component = fixture.componentInstance as any;
    component.createTournament((fixture.nativeElement as HTMLElement).querySelector('input[type="file"]'));
    expect((http.post.mock.calls[0][1] as FormData).has('termsFile')).toBe(false);
  });

  it.each([
    new File(['html'], 'terms.html', { type: 'text/html' }),
    new File([], 'terms.pdf', { type: 'application/pdf' }),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'terms.pdf', { type: 'application/pdf' }),
  ])('shows a useful validation error and clears invalid file selection', (file) => {
    const input = selectFile(file);
    const component = fixture.componentInstance as any;
    expect(component.termsFile()).toBeNull();
    expect(input.value).toBe('');
    expect(fixture.nativeElement.textContent).toContain('must be a PDF file no larger than 10 MB');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('keeps the document selected for retry and shows upload errors', () => {
    const file = new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' });
    const input = selectFile(file);
    http.post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 502, error: { message: 'Document storage unavailable.' },
    })));
    const component = fixture.componentInstance as any;
    component.createTournament(input);
    expect(component.errorMessage()).toBe('Document storage unavailable.');
    expect(component.termsFile()).toBe(file);
    expect(component.isSaving()).toBe(false);
    expect(component.feedbackMessage()).toBe('');
  });
});

describe('TournamentManagementPageComponent registration status', () => {
  const tournament = {
    tournamentId: 'event-1', name: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
    maxSlots: 5, registrationCount: 1, pendingRegistrationCount: 0, date: '', location: '', createdAt: '',
    registrationClosed: false,
  };
  const http = {
    get: vi.fn((url: string) => of(url.endsWith('/admin/tournaments') || url.endsWith('/tournaments') ? [tournament] : [])),
    patch: vi.fn((_url: string, body: { closed: boolean }, _options: unknown) =>
      of({ ...tournament, registrationClosed: body.closed })),
  };
  let fixture: ComponentFixture<TournamentManagementPageComponent>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    http.patch.mockClear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TournamentManagementPageComponent],
      providers: [provideRouter([]), { provide: HttpClient, useValue: http }],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentManagementPageComponent);
    (fixture.componentInstance as any).tournaments.set([tournament]);
    fixture.detectChanges();
  });

  function toggleButton(): HTMLButtonElement {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /registration$/.test(button.textContent!.trim()))!;
  }

  it('closes and reopens registration after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(toggleButton().textContent!.trim()).toBe('Close registration');
    toggleButton().click();
    expect(http.patch).toHaveBeenCalledWith(expect.stringContaining('/admin/tournaments/event-1/registration-status'),
      { closed: true }, { withCredentials: true });
    fixture.detectChanges();
    expect(toggleButton().textContent!.trim()).toBe('Reopen registration');
    expect((fixture.componentInstance as any).feedbackMessage()).toBe('Registration closed.');
    toggleButton().click();
    expect(http.patch).toHaveBeenLastCalledWith(expect.any(String), { closed: false }, { withCredentials: true });
    expect((fixture.componentInstance as any).feedbackMessage()).toBe('Registration reopened.');
  });

  it('does nothing when the admin cancels the confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    toggleButton().click();
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('shows the API error when the status change fails', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    http.patch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 403, error: { message: 'Only admins can change registration status.' },
    })));
    toggleButton().click();
    const component = fixture.componentInstance as any;
    expect(component.errorMessage()).toBe('Only admins can change registration status.');
    expect(component.isSaving()).toBe(false);
  });
});
