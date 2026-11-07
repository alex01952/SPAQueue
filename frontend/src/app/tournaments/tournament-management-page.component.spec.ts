import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TournamentManagementPageComponent } from './tournament-management-page.component';
import type { Tournament, TournamentRegistration } from './tournament.types';

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

  it('shows each player ID and club officer details before an administrator approves the team', () => {
    const component = fixture.componentInstance as any;
    component.registrations.set([{
      tournamentId: 'event-1', registrationId: 'captain', tournamentName: 'Club Open',
      category: 'Mens Doubles', level: 'Beginner', memberId: 'captain', memberName: 'Captain',
      partnerId: 'partner', partnerName: 'Partner', status: 'Pending Approval', registeredAt: '',
      eligibilityDetails: [{
        memberId: 'captain', memberName: 'Captain', fileName: 'school-id.pdf', uploadedAt: '',
        clubDetails: 'City Club\nOfficer Jane: jane@example.com',
        url: '/admin/tournaments/event-1/registrations/captain/player-ids/captain',
      }, {
        memberId: 'partner', memberName: 'Partner', fileName: 'company-id.png', uploadedAt: '',
        clubDetails: '', url: '/admin/tournaments/event-1/registrations/captain/player-ids/partner',
      }],
    }]);
    fixture.detectChanges();
    const section = (fixture.nativeElement as HTMLElement).querySelector('.approval-section')!;
    expect(section.textContent).toContain('Officer Jane: jane@example.com');
    expect(section.textContent).toContain('No club verification details provided.');
    const links = section.querySelectorAll<HTMLAnchorElement>('a');
    expect(links).toHaveLength(2);
    expect(links[0].href).toContain('/player-ids/captain');
    expect(links[1].href).toContain('/player-ids/partner');
    expect(links[0].target).toBe('_blank');
    expect(section.textContent).toContain('Approve team');
  });

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

  it('submits per-player PHP pricing during creation and clears it after success', () => {
    const component = fixture.componentInstance;
    component['pricingForm'] = { regularPrice: 500, earlyBirdPrice: 400, earlyBirdEndDate: '2026-10-31' };
    component['createTournament']((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!);
    expect(JSON.parse((http.post.mock.calls[0][1] as FormData).get('pricing') as string))
      .toEqual({ regularPrice: 500, earlyBirdPrice: 400, earlyBirdEndDate: '2026-10-31' });
    expect(component['pricingForm']).toEqual({ regularPrice: null, earlyBirdPrice: null, earlyBirdEndDate: '' });
  });

  it('shows incomplete pricing errors without publishing the tournament or clearing the draft', () => {
    const component = fixture.componentInstance;
    component['pricingForm'] = { regularPrice: 500, earlyBirdPrice: 400, earlyBirdEndDate: '' };
    component['createTournament']((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!);
    expect(http.post).not.toHaveBeenCalled();
    expect(component['isSaving']()).toBe(false);
    expect(component['errorMessage']()).toContain('both the early-bird price and its end date');
    expect(component['pricingForm'].earlyBirdPrice).toBe(400);
  });

  it('allows creation without a document', () => {
    const component = fixture.componentInstance as any;
    component.createTournament((fixture.nativeElement as HTMLElement).querySelector('input[type="file"]'));
    expect((http.post.mock.calls[0][1] as FormData).has('termsFile')).toBe(false);
  });

  it('offers 2XS through 5XL and submits only the sizes selected by the administrator', () => {
    const component = fixture.componentInstance;
    const checkboxes = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.create-form .tshirt-options input')];
    expect(checkboxes.map((checkbox) => checkbox.parentElement!.textContent!.trim()))
      .toEqual(['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']);
    checkboxes[0].click();
    checkboxes[3].click();
    checkboxes[9].click();
    component['createTournament']((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!);
    expect((http.post.mock.calls[0][1] as FormData).get('tshirtSizes')).toBe('["2XS","M","5XL"]');
    expect(component['selectedTshirtSizes']).toEqual([]);
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

describe('TournamentManagementPageComponent details editor', () => {
  const tournament: Tournament = {
    tournamentId: 'event-1', name: 'Club Open', category: 'Mixed Doubles', level: 'Beginner',
    maxSlots: 8, date: '2027-01-05', location: 'Club courts', registrationCount: 1,
    pendingRegistrationCount: 0, createdAt: '', version: 'v1', registrationClosed: true,
  };
  let fixture: ComponentFixture<TournamentManagementPageComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TournamentManagementPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentManagementPageComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/tournaments').flush([tournament]);
    http.expectOne('/admin/tournament-registrations').flush([]);
    fixture.detectChanges();
  });

  it('edits details while displaying category as read-only', () => {
    const component = fixture.componentInstance;
    component['editDetails'](tournament);
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('.details-form')!;
    expect(form.textContent).toContain('Category: Mixed Doubles');
    expect(form.querySelector('[name="category"]')).toBeNull();
    component['detailsDraft'].name = 'Updated Open';
    component['detailsDraft'].level = 'Advanced';
    component['detailsDraft'].location = 'New courts';
    component['saveDetails'](tournament);
    const request = http.expectOne('/admin/tournaments/event-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.withCredentials).toBe(true);
    const body = request.request.body as FormData;
    expect(body.get('name')).toBe('Updated Open');
    expect(body.get('level')).toBe('Advanced');
    expect(body.get('location')).toBe('New courts');
    expect(body.get('version')).toBe('v1');
    expect(body.has('category')).toBe(false);
    request.flush({ ...tournament, name: 'Updated Open', level: 'Advanced', location: 'New courts', version: 'v2' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Tournament details saved.');
    expect(component['tournaments']()[0].name).toBe('Updated Open');
    expect(component['editingDetailsId']()).toBeNull();
    http.verify();
  });

  it('retains the draft and reports a conflict without changing the displayed tournament', () => {
    const component = fixture.componentInstance;
    component['editDetails'](tournament);
    component['detailsDraft'].name = 'Draft name';
    component['saveDetails'](tournament);
    http.expectOne('/admin/tournaments/event-1').flush({ message: 'The tournament changed. Reload and retry.' }, { status: 409, statusText: 'Conflict' });
    expect(component['detailsDraft'].name).toBe('Draft name');
    expect(component['tournaments']()[0].name).toBe('Club Open');
    expect(component['errorMessage']()).toContain('Reload and retry');
    expect(component['isSaving']()).toBe(false);
    component['editingDetailsId'].set(null);
    expect(component['editingDetailsId']()).toBeNull();
    http.verify();
  });

  it('prevents native navigation when the details form is submitted', () => {
    fixture.componentInstance['editDetails'](tournament);
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('.details-form')!;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const request = http.expectOne('/admin/tournaments/event-1');
    expect(request.request.method).toBe('PATCH');
    request.flush({ ...tournament, version: 'v2' });
    http.verify();
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

describe('TournamentManagementPageComponent approved teams CSV', () => {
    const tournament: Tournament = {
      tournamentId: 'event-1', name: 'Club, "Open"', category: 'Mixed Doubles', level: 'Beginner',
      maxSlots: 8, registrationCount: 1, pendingRegistrationCount: 0, date: '2026-10-22',
      location: 'Club courts', createdAt: '',
    };
    const team: TournamentRegistration = {
      tournamentId: 'event-1', registrationId: 'team-1', tournamentName: tournament.name,
      category: tournament.category, level: tournament.level, status: 'Approved',
      memberId: 'alice', memberName: 'Alice', partnerId: 'bob', partnerName: 'Bob',
      registeredAt: '2026-10-01', approvedAt: '2026-10-02', memberTshirtSize: 'XS', partnerTshirtSize: '2XL',
    };
    let fixture: ComponentFixture<TournamentManagementPageComponent>;
    let http: HttpTestingController;
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test-export');
    const revokeObjectURL = vi.fn();
    let click: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
      click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      await TestBed.configureTestingModule({
        imports: [TournamentManagementPageComponent],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      }).compileComponents();
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(TournamentManagementPageComponent);
      fixture.detectChanges();
      http.expectOne((item) => item.url.endsWith('/tournaments')).flush([tournament]);
      http.expectOne((item) => item.url.endsWith('/admin/tournament-registrations')).flush([]);
      fixture.detectChanges();
    });

    afterEach(() => {
      http.verify();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function exportRequest() {
      fixture.componentInstance['exportApprovedTeams'](tournament);
      return http.expectOne((item) => item.url.endsWith('/admin/tournament-registrations'));
    }

    it('edits, retries, saves, and removes pricing on published events', async () => {
      const component = fixture.componentInstance;
      component['editPricing']({ ...tournament, pricing: { regularPrice: 500 } });
      fixture.detectChanges();
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      const field = root.querySelector<HTMLInputElement>('.event-actions input[name="regularPrice"]')!;
      expect(field.value).toBe('500');
      field.value = '650.25';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      component['savePricing'](tournament);
      let request = http.expectOne((item) => item.url.endsWith('/event-1/pricing'));
      expect(request.request.method).toBe('PATCH');
      expect(request.request.withCredentials).toBe(true);
      expect(request.request.body).toEqual({ pricing: { regularPrice: 650.25 } });
      request.flush({ message: 'Pricing storage unavailable.' }, { status: 502, statusText: 'Bad Gateway' });
      expect(component['errorMessage']()).toBe('Pricing storage unavailable.');
      expect(component['editingPricingId']()).toBe('event-1');
      expect(component['pricingDraft'].regularPrice).toBe(650.25);
      component['savePricing'](tournament);
      http.expectOne((item) => item.url.endsWith('/event-1/pricing')).flush({ ...tournament, pricing: { regularPrice: 650.25 } });
      expect(component['tournaments']()[0].pricing).toEqual({ regularPrice: 650.25 });
      expect(component['editingPricingId']()).toBeNull();
      component['editPricing'](component['tournaments']()[0]);
      component['pricingDraft'].regularPrice = null;
      component['savePricing'](tournament);
      request = http.expectOne((item) => item.url.endsWith('/event-1/pricing'));
      expect(request.request.body).toEqual({ pricing: null });
      request.flush(tournament);
      expect(component['tournaments']()[0].pricing).toBeUndefined();
    });

    it('saves edited sizes for an existing event and retains draft options on failure', () => {
      const component = fixture.componentInstance;
      component['toggleTshirtSize']('2XS', true, tournament);
      component['toggleTshirtSize']('3XL', true, tournament);
      component['saveTshirtSizes'](tournament);
      const request = http.expectOne((item) => item.url.endsWith('/event-1/tshirt-sizes'));
      expect(request.request.method).toBe('PATCH');
      expect(request.request.withCredentials).toBe(true);
      expect(request.request.body).toEqual({ tshirtSizes: ['2XS', '3XL'] });
      request.flush({ message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' });
      expect(component['tshirtSizeDrafts']()['event-1']).toEqual(['2XS', '3XL']);
      expect(component['errorMessage']()).toBe('Storage unavailable');
      component['saveTshirtSizes'](tournament);
      http.expectOne((item) => item.url.endsWith('/event-1/tshirt-sizes'))
        .flush({ ...tournament, tshirtSizes: ['2XS', '3XL'] });
      expect(component['tournaments']()[0].tshirtSizes).toEqual(['2XS', '3XL']);
      expect(component['tshirtSizeDrafts']()['event-1']).toBeUndefined();
    });

    function readCsv(): Promise<string> {
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe('text/csv;charset=utf-8');
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
    }

    it('fetches fresh teams, exports only confirmed statuses for the selected event and preserves doubles partners', async () => {
      expect(fixture.nativeElement.textContent).toContain('Export approved teams (CSV)');
      const request = exportRequest();
      expect(request.request.withCredentials).toBe(true);
      request.flush([
        team,
        { ...team, registrationId: 'team-2', status: 'Payment Submitted' },
        { ...team, registrationId: 'team-3', status: 'Paid', paidAt: '2026-10-03' },
        { ...team, registrationId: 'pending', status: 'Pending Approval' },
        { ...team, registrationId: 'invited', status: 'Invitation Pending' },
        { ...team, registrationId: 'declined', status: 'Invitation Declined' },
        { ...team, tournamentId: 'another-event', registrationId: 'wrong-event' },
      ]);
      const csv = await readCsv();
      expect(csv.split('\r\n')).toHaveLength(5);
      expect(csv).toContain('"Club, ""Open"""');
      expect(csv).toContain('"alice","Alice","XS","bob","Bob","2XL","","","","","",""');
      expect(csv).toContain('"team-3","Paid","2026-10-01","2026-10-02","2026-10-03"');
      expect(csv).not.toMatch(/pending|invited|declined|wrong-event/);
      expect(click).toHaveBeenCalledTimes(1);
      const link = click.mock.instances[0] as HTMLAnchorElement;
      expect(link.download).toMatch(/^tournament-event-1-approved-teams-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(link.isConnected).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-export');
      expect(fixture.componentInstance['feedbackMessage']()).toContain('3 approved teams');
    });

    it('exports all four team players and safely escapes names and spreadsheet formulas', async () => {
      exportRequest().flush([{
        ...team, teamMembers: [
          { memberId: 'p1', name: 'Maria, "Ace"\nSantos', gender: 'Female', accepted: true },
          { memberId: 'p2', name: '=HYPERLINK("bad")', gender: 'Male', accepted: true },
          { memberId: 'p3', name: ' +formula', gender: 'Male', accepted: true, tshirtSize: '2XS' },
          { memberId: 'p4', name: '@formula', gender: 'Female', accepted: true, tshirtSize: '3XL' },
        ],
      }]);
      const csv = await readCsv();
      expect(csv).toContain('"p1","Maria, ""Ace""\nSantos"');
      expect(csv).toContain(`"p2","'=HYPERLINK(""bad"")"`);
      expect(csv).toContain(`"p3","' +formula","2XS","p4","'@formula","3XL"`);
      expect(csv).not.toContain('"alice"');
      expect(csv.split('\r\n')[0].split(',')).toHaveLength(23);
    });

    it('downloads a header-only CSV when there are no approved teams', async () => {
      exportRequest().flush([]);
      const csv = await readCsv();
      expect(csv.split('\r\n')).toHaveLength(2);
      expect(csv).toContain('"Player 4 ID","Player 4 name"');
      expect(fixture.componentInstance['feedbackMessage']()).toContain('0 approved teams');
    });

    it('locks actions while loading and prevents duplicate exports', () => {
      const request = exportRequest();
      fixture.componentInstance['exportApprovedTeams'](tournament);
      fixture.detectChanges();
      expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
      request.flush([]);
      expect(fixture.componentInstance['isSaving']()).toBe(false);
    });

    it('reports API errors without downloading or reporting success', () => {
      exportRequest().flush({ message: 'Administrator access is required.' }, { status: 403, statusText: 'Forbidden' });
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(fixture.componentInstance['errorMessage']()).toBe('Administrator access is required.');
      expect(fixture.componentInstance['feedbackMessage']()).toBe('');
      expect(fixture.componentInstance['isSaving']()).toBe(false);
    });
});
