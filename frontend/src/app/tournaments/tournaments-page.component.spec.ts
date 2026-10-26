import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { MemberAuthService } from '../member-auth.service';
import type { TournamentRegistration } from './tournament.types';
import { TournamentsPageComponent } from './tournaments-page.component';

describe('TournamentsPageComponent', () => {
  let fixture: ComponentFixture<TournamentsPageComponent>;
  const member = signal({ memberId: 'invited-member', gender: 'Male' });
  const playerId = new File(['%PDF-1.7'], 'player-id.pdf', { type: 'application/pdf' });
  const http = {
    get: vi.fn(() => of([])),
    post: vi.fn((_url: string, _body: unknown, _options: unknown) => of({})),
    delete: vi.fn((): Observable<{ deleted: true } | null> => of({ deleted: true })),
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    http.get.mockClear();
    http.post.mockClear();
    http.delete.mockReset().mockReturnValue(of({ deleted: true }));
    await TestBed.configureTestingModule({
      imports: [TournamentsPageComponent],
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: MemberAuthService, useValue: { member: member.asReadonly() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentsPageComponent);
    fixture.detectChanges();
  });

  it('recognizes an incoming pending invitation when the API omits its marker', () => {
    const invitation = {
      status: 'Invitation Pending',
      partnerId: 'invited-member',
    } as TournamentRegistration;

    expect((fixture.componentInstance as any).isIncomingInvitation(invitation)).toBe(true);
  });

  const registration: TournamentRegistration = {
    tournamentId: 'event-1', registrationId: 'captain', tournamentName: 'Club Open',
    category: 'Team Tournament', level: 'Intermediate',
    memberId: 'captain', memberName: 'Captain', partnerId: 'partner', partnerName: 'Partner',
    status: 'Invitation Pending', registeredAt: '2026-10-19',
    teamMembers: [{ memberId: 'invited-member', name: 'Invitee', gender: 'Male', accepted: false }],
  };

  it('requires each player ID while keeping club verification optional', () => {
    const component = fixture.componentInstance as any;
    component.activeTournament.set({ tournamentId: 'event-1', category: 'Mens Doubles' });
    component.selectedPartnerId.set('partner');
    Object.assign(component.memberExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    component.register();
    expect(http.post).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('Upload your school, government, or company ID');
    component.beginAccepting(registration);
    Object.assign(component.partnerExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    component.respond(registration, 'Accepted');
    expect(http.post).not.toHaveBeenCalled();
    component.partnerIdFile.set(playerId);
    component.respond(registration, 'Accepted');
    const body = http.post.mock.calls.at(-1)![1] as FormData;
    expect(body.get('idFile')).toBe(playerId);
    expect(body.get('clubDetails')).toBe('');
  });

  it.each([
    new File(['html'], 'id.html', { type: 'text/html' }),
    new File([], 'id.pdf', { type: 'application/pdf' }),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'id.pdf', { type: 'application/pdf' }),
  ])('rejects unsupported, empty, and oversized ID selections', (file) => {
    const component = fixture.componentInstance as any;
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    component.memberIdFile.set(playerId);
    component.selectIdFile(input);
    expect(component.memberIdFile()).toBeNull();
    expect(component.errorMessage()).toContain('PDF, JPEG, or PNG');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('submits club and officer details with an ID and clears them when the form closes', () => {
    const component = fixture.componentInstance as any;
    component.activeTournament.set({ tournamentId: 'event-1', category: 'Mens Doubles' });
    component.selectedPartnerId.set('partner');
    Object.assign(component.memberExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [playerId] });
    component.selectIdFile(input);
    component.memberClubDetails = 'City Club\nJane Doe: jane@example.com';
    component.register();
    const body = http.post.mock.calls.at(-1)![1] as FormData;
    expect(body.get('clubDetails')).toBe('City Club\nJane Doe: jane@example.com');
    expect(body.get('idFile')).toBe(playerId);
    expect(component.memberIdFile()).toBeNull();
    expect(component.memberClubDetails).toBe('');
  });

  it('preserves ID and club details when an upload fails so the player can retry', () => {
    const component = fixture.componentInstance as any;
    component.beginAccepting(registration);
    Object.assign(component.partnerExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    component.partnerIdFile.set(playerId);
    component.partnerClubDetails = 'City Club';
    http.post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 502, error: { message: 'ID storage unavailable.' },
    })));
    component.respond(registration, 'Accepted');
    expect(component.errorMessage()).toBe('ID storage unavailable.');
    expect(component.partnerIdFile()).toBe(playerId);
    expect(component.partnerClubDetails).toBe('City Club');
    expect(component.isWorking()).toBe(false);
  });

  it('requires the sender agreement, opens terms separately, and submits explicit consent', async () => {
    const component = fixture.componentInstance as any;
    const tournament = {
      tournamentId: 'event-1', name: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
      maxSlots: 5, registrationCount: 0, pendingRegistrationCount: 0, date: '', location: '', createdAt: '',
      termsUrl: '/tournaments/event-1/terms',
    };
    component.tournaments.set([tournament]);
    component.openRegistration(tournament);
    component.selectedPartnerId.set('partner');
    Object.assign(component.memberExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector('.registration-panel')!;
    const link = form.querySelector<HTMLAnchorElement>('.terms-agreement a')!;
    expect(link.href).toContain('/tournaments/event-1/terms');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    component.register();
    expect(http.post).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('must agree');
    const checkbox = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    component.memberIdFile.set(playerId);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
    component.register();
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/event-1/registrations'),
      expect.any(FormData), { withCredentials: true });
    const body = http.post.mock.calls.at(-1)![1] as FormData;
    expect(body.get('termsAccepted')).toBe('true');
    expect(body.get('idFile')).toBe(playerId);
    component.openRegistration(tournament);
    expect(component.memberTermsAccepted).toBe(false);
  });

  it('requires each invitee agreement before acceptance and resets it on reopening', async () => {
    const component = fixture.componentInstance as any;
    const invitation = { ...registration, termsUrl: '/tournaments/event-1/terms' };
    component.registrations.set([invitation]);
    component.beginAccepting(invitation);
    Object.assign(component.partnerExperienceForm, { hasJoinedTournaments: false, hasWonTournaments: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector('.partner-experience-form')!;
    expect(form.querySelector<HTMLAnchorElement>('.terms-agreement a')!.target).toBe('_blank');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    component.respond(invitation, 'Accepted');
    expect(http.post).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('must agree');
    form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    component.partnerIdFile.set(playerId);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
    component.respond(invitation, 'Accepted');
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/captain/respond'),
      expect.any(FormData), { withCredentials: true });
    const body = http.post.mock.calls.at(-1)![1] as FormData;
    expect(body.get('termsAccepted')).toBe('true');
    expect(body.get('decision')).toBe('Accepted');
    expect(body.get('idFile')).toBe(playerId);
    component.beginAccepting(invitation);
    expect(component.partnerTermsAccepted).toBe(false);
  });

  it('does not require agreement to decline even when terms exist', () => {
    const component = fixture.componentInstance as any;
    component.respond({ ...registration, termsUrl: '/tournaments/event-1/terms' }, 'Declined');
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/captain/respond'),
      { decision: 'Declined' }, { withCredentials: true });
  });

  it('shows approved slots and a separate pending count without disabling registration', () => {
    const component = fixture.componentInstance as any;
    const tournament = {
      tournamentId: 'event-1', name: 'Club Open', category: 'Mixed Doubles',
      level: 'Beginner', maxSlots: 5, registrationCount: 1, pendingRegistrationCount: 4,
      date: '', location: '', createdAt: '',
    };
    component.tournaments.set([tournament]);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.tournament-row')!;
    expect(row.textContent).toContain('1 / 5');
    expect(row.textContent).toContain('4 pending approval');
    expect(row.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    expect(component.slotPercentage(tournament)).toBe(20);
    component.tournaments.set([{ ...tournament, registrationCount: 5 }]);
    fixture.detectChanges();
    expect(row.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });

  it.each(['Invitation Pending', 'Pending Approval', 'Approved', 'Payment Submitted'] as const)(
    'shows cancellation for an unpaid %s registration', (status) => {
      const component = fixture.componentInstance as any;
      component.registrations.set([{ ...registration, status }]);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Leave team / Cancel registration');
    },
  );

  it.each(['Paid', 'Invitation Declined'] as const)(
    'hides cancellation for %s', (status) => {
      const component = fixture.componentInstance as any;
      component.registrations.set([{ ...registration, status }]);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Leave team / Cancel registration');
      component.cancelRegistration({ ...registration, status });
      expect(http.delete).not.toHaveBeenCalled();
    },
  );

  it('warns that leaving cancels the whole team and does nothing when dismissed', () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    (fixture.componentInstance as any).cancelRegistration(registration);
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining('ALL members of the team'));
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('cancels after confirmation and refreshes entries and slots', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    http.get.mockClear();
    const component = fixture.componentInstance as any;
    component.registrations.set([registration]);
    fixture.detectChanges();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const cancelButton = Array.from(buttons).find((button) => button.textContent?.includes('Leave team'));
    expect(cancelButton).toBeDefined();
    cancelButton!.click();
    expect(http.delete).toHaveBeenCalledWith(
      expect.stringContaining('/tournaments/event-1/registrations/captain'),
      { withCredentials: true },
    );
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(component.feedbackMessage()).toContain('cancelled for all team members');
    expect(component.isWorking()).toBe(false);
  });

  it('does not offer cancellation after payment is confirmed', () => {
    const component = fixture.componentInstance as any;
    const paidRegistration = { ...registration, status: 'Paid', paymentProofUrl: 'https://example.com/proof.pdf' };
    component.registrations.set([paidRegistration]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Leave team / Cancel registration');
    component.cancelRegistration(paidRegistration);
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('prevents duplicate cancellation requests while working', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const response = new Subject<{ deleted: true }>();
    http.delete.mockReturnValue(response);
    const component = fixture.componentInstance as any;
    component.cancelRegistration(registration);
    component.cancelRegistration(registration);
    expect(http.delete).toHaveBeenCalledTimes(1);
    response.next({ deleted: true });
    response.complete();
  });

  it('surfaces cancellation failures without showing success', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    http.delete.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'Payment has already been submitted.' },
    })));
    const component = fixture.componentInstance as any;
    component.cancelRegistration(registration);
    expect(component.errorMessage()).toBe('Payment has already been submitted.');
    expect(component.feedbackMessage()).toBe('');
    expect(component.isWorking()).toBe(false);
  });

  it('accepts a successful 204 response without treating its empty body as an error', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    http.delete.mockReturnValue(of(null));
    const component = fixture.componentInstance as any;
    component.cancelRegistration(registration);
    expect(component.feedbackMessage()).toContain('cancelled for all team members');
    expect(component.errorMessage()).toBe('');
    expect(component.isWorking()).toBe(false);
  });

  it('explains network or CORS failures without claiming cancellation succeeded', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    http.delete.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const component = fixture.componentInstance as any;
    component.cancelRegistration(registration);
    expect(component.errorMessage()).toContain('Unable to reach the API');
    expect(component.errorMessage()).toContain('CORS');
    expect(component.feedbackMessage()).toBe('');
    expect(component.isWorking()).toBe(false);
  });

  it.each(['Approved', 'Payment Submitted'] as const)('enables a real file selection and uploads for %s', (status) => {
    const component = fixture.componentInstance as any;
    const approvedRegistration = { ...registration, status };
    component.registrations.set([approvedRegistration]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const button = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.includes('Upload proof'))!;
    expect(button.disabled).toBe(true);
    const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    expect(element.textContent).toContain('receipt.pdf');
    button.click();
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/registrations/captain/payment-proof'),
      expect.any(FormData), { withCredentials: true },
    );
    const request = http.post.mock.calls.at(-1)!;
    expect((request[1] as FormData).get('file')).toBe(file);
    expect(component.feedbackMessage()).toContain('An admin must confirm payment');
    expect(component.isWorking()).toBe(false);
  });

  it('locks all player actions when paid but keeps proof viewing available', () => {
    const component = fixture.componentInstance as any;
    const paid = {
      ...registration, status: 'Paid',
      paymentProofs: [{ memberId: 'invited-member', memberName: 'Invitee', fileName: 'receipt.pdf', uploadedAt: '2026-10-19', url: '/tournaments/event-1/registrations/captain/payment-proofs/invited-member' }],
    };
    component.registrations.set([paid]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[type="file"]')).toBeNull();
    expect(element.textContent).not.toContain('Leave team / Cancel registration');
    expect(element.textContent).toContain('Player changes are locked');
    expect(element.querySelector<HTMLAnchorElement>('.proof-link')?.href).toContain('/payment-proofs/invited-member');
    component.uploadProof(paid);
    component.cancelRegistration(paid);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid proof files with visible feedback', () => {
    const component = fixture.componentInstance as any;
    component.selectProofFile(registration, new File(['html'], 'receipt.html', { type: 'text/html' }));
    expect(component.errorMessage()).toContain('PDF, JPEG, or PNG');
    expect(component.selectedProofFile(registration)).toBeUndefined();
    component.uploadProof({ ...registration, status: 'Approved' });
    expect(component.errorMessage()).toContain('Select a payment-proof file');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('shows API upload errors and keeps the file available for retry', () => {
    const component = fixture.componentInstance as any;
    const approved = { ...registration, status: 'Approved' };
    const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
    component.selectProofFile(approved, file);
    http.post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'Registration is already paid.' },
    })));
    component.uploadProof(approved);
    expect(component.errorMessage()).toBe('Registration is already paid.');
    expect(component.selectedProofFile(approved)).toBe(file);
    expect(component.isWorking()).toBe(false);
  });

  it('explains contradictory history answers next to acceptance actions and clears the warning when corrected', async () => {
    const component = fixture.componentInstance as any;
    component.registrations.set([registration]);
    component.beginAccepting(registration);
    component.partnerIdFile.set(playerId);
    Object.assign(component.partnerExperienceForm, {
      hasJoinedTournaments: false,
      hasWonTournaments: true,
      highestWinningLevel: 'Beginner',
      winsOrPodiums: 1,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const form = (fixture.nativeElement as HTMLElement).querySelector('.partner-experience-form')!;
    const warning = form.querySelector('[role="alert"]')!;
    expect(warning.textContent).toContain('Cannot accept invitation');
    expect(warning.textContent).toContain('change the first answer to Yes');
    expect(warning.nextElementSibling?.classList.contains('row-actions')).toBe(true);
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);

    const winAnswer = form.querySelector<HTMLSelectElement>('select[name="partnerHasWon"]')!;
    winAnswer.value = Array.from(winAnswer.options).find((option) => option.textContent?.trim() === 'No')!.value;
    winAnswer.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(form.querySelector('[role="alert"]')).toBeNull();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('shows the same contradiction warning when sending invitations', () => {
    const component = fixture.componentInstance as any;
    const tournament = {
      tournamentId: 'event-1', name: 'Club Open', category: 'Mixed Doubles',
      level: 'Beginner', maxSlots: 8, registrationCount: 0, pendingRegistrationCount: 0, date: '', location: '', createdAt: '',
    };
    component.tournaments.set([tournament]);
    component.openRegistration(tournament);
    Object.assign(component.memberExperienceForm, {
      hasJoinedTournaments: false, hasWonTournaments: true,
      highestWinningLevel: 'Beginner', winsOrPodiums: 1,
    });
    fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector('.registration-panel')!;
    expect(form.querySelector('[role="alert"]')?.textContent).toContain('Cannot send invitations');
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('requires three teammates and a two-men, two-women roster before submitting', () => {
    const component = fixture.componentInstance as any;
    component.activeTournament.set({ category: 'Team Tournament' });
    const maleTeammate = { memberId: 'male-2', name: 'Male Two', gender: 'Male', eligible: true };
    const extraMale = { memberId: 'male-3', name: 'Male Three', gender: 'Male', eligible: true };
    const firstWoman = { memberId: 'female-1', name: 'Female One', gender: 'Female', eligible: true };
    const secondWoman = { memberId: 'female-2', name: 'Female Two', gender: 'Female', eligible: true };

    component.toggleTeamMember(maleTeammate);
    expect(component.canToggleTeamMember(extraMale)).toBe(false);
    component.toggleTeamMember(extraMale);
    component.toggleTeamMember(firstWoman);
    component.toggleTeamMember(secondWoman);

    expect(component.isTeamRosterComplete()).toBe(true);
    Object.assign(component.memberExperienceForm, {
      hasJoinedTournaments: false,
      hasWonTournaments: false,
    });
    component.memberIdFile.set(playerId);
    component.register();

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/registrations'),
      expect.any(FormData),
      { withCredentials: true },
    );
    const body = http.post.mock.calls.at(-1)![1] as FormData;
    expect(body.get('partnerId')).toBe('male-2');
    expect(JSON.parse(String(body.get('teamMemberIds')))).toEqual(['male-2', 'female-1', 'female-2']);
  });
});

describe('TournamentsPageComponent closed registration', () => {
  const tournament = {
    tournamentId: 'event-1', name: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
    maxSlots: 5, registrationCount: 2, pendingRegistrationCount: 0, date: '', location: '', createdAt: '',
    registrationClosed: true,
  };
  const base: TournamentRegistration = {
    tournamentId: 'event-1', registrationId: 'reg-1', tournamentName: 'Club Open',
    category: 'Mens Doubles', level: 'Beginner', memberId: 'captain', memberName: 'Captain',
    partnerId: 'me', partnerName: 'Me', status: 'Approved', registeredAt: '2026-10-19',
  };

  async function render(registrations: TournamentRegistration[], closed = true) {
    const http = {
      get: vi.fn((url: string) => of(url.endsWith('/tournament-registrations')
        ? registrations : [{ ...tournament, registrationClosed: closed }])),
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TournamentsPageComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: MemberAuthService, useValue: { member: signal({ memberId: 'me', gender: 'Male' }).asReadonly() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TournamentsPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the closed state instead of Register', async () => {
    const fixture = await render([]);
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Registration closed');
  });

  it.each(['Approved', 'Payment Submitted', 'Paid'] as const)('links %s participants to the roster', async (status) => {
    const fixture = await render([{ ...base, status }]);
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.roster-link');
    expect(link?.getAttribute('href')).toBe('/tournaments/event-1/roster');
  });

  it('hides the roster link while registration is open or for unconfirmed teams', async () => {
    let fixture = await render([{ ...base, status: 'Approved' }], false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.roster-link')).toBeNull();
    fixture = await render([{ ...base, status: 'Pending Approval' }]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.roster-link')).toBeNull();
  });

  it('offers only Decline for incoming invitations once registration is closed', async () => {
    const fixture = await render([{ ...base, status: 'Invitation Pending' }]);
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.registration-row button')]
      .map((button) => button.textContent!.trim());
    expect(buttons).toContain('Decline');
    expect(buttons).not.toContain('Accept');
    expect(fixture.nativeElement.textContent).toContain('can no longer be accepted');
  });
});