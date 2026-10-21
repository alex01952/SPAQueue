import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TournamentArchivePageComponent } from './tournament-archive-page.component';
import { TournamentManagementPageComponent } from './tournament-management-page.component';
import type { ArchivedTournament, TournamentArchiveDetails } from './tournament.types';

const tournament: ArchivedTournament = {
  tournamentId: 'event-1', name: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
  maxSlots: 8, date: '', location: 'Club courts', registrationCount: 1, pendingRegistrationCount: 0,
  createdAt: '2026-10-01', archivedAt: '2026-10-21T08:00:00Z', archivedBy: 'Admin',
};

describe('TournamentArchivePageComponent', () => {
  let fixture: ComponentFixture<TournamentArchivePageComponent>;
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TournamentArchivePageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TournamentArchivePageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/admin/tournament-archive')).flush([tournament]);
    fixture.detectChanges();
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  it('shows the archived list and renders records without editing actions', () => {
    fixture.componentInstance['view'](tournament);
    const details: TournamentArchiveDetails = {
      tournament: { ...tournament, termsUrl: '/admin/tournament-archive/event-1/terms' },
      registrations: [{
        tournamentId: 'event-1', registrationId: 'team-1', tournamentName: 'Club Open',
        category: 'Mens Doubles', level: 'Beginner', memberId: 'a', memberName: 'Alice',
        partnerId: 'b', partnerName: 'Bob', status: 'Paid', registeredAt: '2026-10-01',
        paymentProofs: [{
          memberId: 'a', memberName: 'Alice', fileName: 'proof.pdf', uploadedAt: '2026-10-01',
          url: '/admin/tournament-archive/event-1/registrations/team-1/payment-proofs/a',
        }],
      }],
      protests: [],
      roster: {
        tournamentId: 'event-1', tournamentName: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
        canManageRoster: false, teams: [{ registrationId: 'team-1', status: 'Paid', isOwnTeam: false, players: [] }],
      },
      draw: {
        version: 'v1', rosterSignature: 'hash', pools: [{ number: 1, registrationIds: ['team-1'] }],
        courtCount: 1, schedule: [], updatedAt: '2026-10-21T08:00:00Z', updatedBy: 'admin',
      },
    };
    const request = http.expectOne((item) => item.url.endsWith('/admin/tournament-archive/event-1'));
    expect(request.request.withCredentials).toBe(true);
    request.flush(details);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Alice + Bob');
    expect(element.textContent).toContain('Pool 1');
    expect(element.textContent).toContain('Paid');
    expect(element.querySelector<HTMLAnchorElement>('a[href$="/terms"]')!.href).toContain('/admin/tournament-archive/');
    expect(element.querySelector<HTMLAnchorElement>('a[href$="/payment-proofs/a"]')!.href).toContain('/admin/tournament-archive/');
    const buttons = [...element.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons.join(' ')).not.toMatch(/Approve|Mark.*paid|Replace|Generate|Randomize/i);
  });

  it('requires confirmation, locks actions during deletion and removes the row on success', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    fixture.componentInstance['remove'](tournament);
    http.expectNone((item) => item.method === 'DELETE');
    fixture.componentInstance['remove'](tournament);
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
    fixture.componentInstance['remove'](tournament);
    const request = http.expectOne((item) => item.method === 'DELETE');
    expect(request.request.url).toContain('/admin/tournament-archive/event-1');
    request.flush({ deleted: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No archived tournaments.');
  });

  it('shows API errors and retains the row for retry', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.componentInstance['remove'](tournament);
    http.expectOne((item) => item.method === 'DELETE').flush({ message: 'Retry deletion to finish.' }, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry deletion to finish.');
    expect(fixture.componentInstance['tournaments']()).toHaveLength(1);
    expect(fixture.componentInstance['busy']()).toBe(false);
  });
});

describe('Tournament management lifecycle actions', () => {
  let fixture: ComponentFixture<TournamentManagementPageComponent>;
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TournamentManagementPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TournamentManagementPageComponent);
    fixture.detectChanges();
    http.expectOne((item) => item.url.endsWith('/tournaments')).flush([tournament]);
    http.expectOne((item) => item.url.endsWith('/admin/tournament-registrations')).flush([]);
    fixture.detectChanges();
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  it.each(['archive', 'delete'] as const)('confirms, locks, sends and removes the tournament for %s', (action) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const invoke = () => action === 'archive'
      ? fixture.componentInstance['archiveTournament'](tournament)
      : fixture.componentInstance['deleteTournament'](tournament);
    invoke();
    invoke();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Processing tournament changes');
    expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
    const request = http.expectOne((item) => item.method === (action === 'archive' ? 'POST' : 'DELETE'));
    expect(request.request.url).toContain(`/admin/tournaments/event-1${action === 'archive' ? '/archive' : ''}`);
    expect(request.request.withCredentials).toBe(true);
    request.flush(action === 'archive' ? { archived: true } : { deleted: true });
    expect(fixture.componentInstance['tournaments']()).toEqual([]);
  });

  it('does not delete when confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance['deleteTournament'](tournament);
    http.expectNone((item) => item.method === 'DELETE');
  });

  it('reports partial operation errors, retaining the tournament for retry', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.componentInstance['archiveTournament'](tournament);
    http.expectOne((item) => item.method === 'POST').flush({ message: 'Retry the same action to finish safely.' }, { status: 502, statusText: 'Bad Gateway' });
    expect(fixture.componentInstance['tournaments']()).toHaveLength(1);
    expect(fixture.componentInstance['isSaving']()).toBe(false);
    expect(fixture.componentInstance['errorMessage']()).toContain('Retry the same action');
  });
});
