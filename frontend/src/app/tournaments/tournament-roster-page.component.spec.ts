import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { TournamentProtest, TournamentRoster } from './tournament.types';
import { TournamentRosterPageComponent } from './tournament-roster-page.component';

describe('TournamentRosterPageComponent', () => {
  let fixture: ComponentFixture<TournamentRosterPageComponent>;
  let roster: TournamentRoster;
  let myProtests: TournamentProtest[];
  const http: any = {
    get: vi.fn((url: string) => of(url.endsWith('/protests/mine') ? myProtests : roster)),
    post: vi.fn((_url: string, _body: unknown, _options: unknown) => of({} as TournamentProtest)),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const reason = 'Player is registered as Beginner but won an advanced open last season.';

  async function render() {
    await TestBed.configureTestingModule({
      imports: [TournamentRosterPageComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ tournamentId: 'event-1' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentRosterPageComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    http.get.mockClear();
    http.post.mockReset();
    http.patch.mockReset();
    http.delete.mockReset();
    myProtests = [];
    roster = {
      tournamentId: 'event-1', tournamentName: 'Club Open', category: 'Mens Doubles', level: 'Beginner',
      canManageRoster: false,
      teams: [
        { registrationId: 'own', status: 'Paid', isOwnTeam: true, players: [
          { memberId: 'me', name: 'Me', gender: 'Male' }, { memberId: 'mate', name: 'Mate', gender: 'Male' },
        ] },
        { registrationId: 'other', status: 'Approved', isOwnTeam: false, players: [
          { memberId: 'rival', name: 'Rival', gender: 'Male' }, { memberId: 'rival-2', name: 'Rival Two', gender: 'Male' },
        ] },
      ],
    };
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function selectEvidence(files: File[]): HTMLInputElement {
    const input = element().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return input;
  }

  function startProtest(name: string) {
    const button = [...element().querySelectorAll<HTMLButtonElement>('.team-card li')]
      .find((item) => item.textContent!.includes(name))!.querySelector('button')!;
    button.click();
    fixture.detectChanges();
  }

  it('loads the roster and protests, and offers protests only for other teams', async () => {
    await render();
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/tournaments/event-1/roster'), { withCredentials: true });
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/tournaments/event-1/protests/mine'), { withCredentials: true });
    const cards = element().querySelectorAll('.team-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Your team');
    expect(cards[0].querySelectorAll('button')).toHaveLength(0);
    expect(cards[1].querySelectorAll('button')).toHaveLength(2);
  });

  it('does not offer protests to an admin who is not on the roster', async () => {
    roster.teams = roster.teams.map((team) => ({ ...team, isOwnTeam: false }));
    await render();
    expect(element().querySelectorAll('.team-card button')).toHaveLength(0);
    expect(http.get).not.toHaveBeenCalledWith(expect.stringContaining('/protests/mine'), expect.anything());
  });

  it('shows roster administration controls and replaces a player', async () => {
    roster.canManageRoster = true;
    await render();
    expect(element().querySelectorAll('.remove-button')).toHaveLength(2);
    expect(element().querySelectorAll('.team-card .quiet-button')).toHaveLength(6);

    const component = fixture.componentInstance as any;
    component.beginReplacement(roster.teams[1], roster.teams[1].players[0]);
    component.replacementSearch = 'rep';
    http.get.mockReturnValueOnce(of([
      { memberId: 'replacement-1', name: 'Replacement', gender: 'Male', eligible: true },
    ]));
    component.searchReplacementCandidates();
    expect(http.get).toHaveBeenLastCalledWith(
      expect.stringContaining('/replacement-candidates?search=rep'),
      { withCredentials: true },
    );

    const replacement = { memberId: 'replacement-1', name: 'Replacement', gender: 'Male' };
    http.patch.mockReturnValueOnce(of(replacement));
    component.replacePlayer(component.replacementCandidates()[0]);

    expect(http.patch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/tournaments/event-1/roster/other/players/rival'),
      { replacementMemberId: 'replacement-1' },
      { withCredentials: true },
    );
    expect(component.roster().teams[1].players[0]).toEqual(replacement);
    expect(component.feedbackMessage()).toContain('was replaced');
  });

  it('removes a roster team through the admin registration endpoint', async () => {
    roster.canManageRoster = true;
    await render();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    http.delete.mockReturnValueOnce(of({ deleted: true }));

    (fixture.componentInstance as any).removeTeam(roster.teams[1]);

    expect(http.delete).toHaveBeenCalledWith(
      expect.stringContaining('/admin/tournaments/event-1/registrations/other'),
      { withCredentials: true },
    );
    expect((fixture.componentInstance as any).roster().teams).toHaveLength(1);
  });

  it('marks players that already have an open protest', async () => {
    myProtests = [{ protestId: 'p1', protestedMemberId: 'rival', status: 'Open', evidence: [] } as unknown as TournamentProtest];
    await render();
    const rival = [...element().querySelectorAll('.team-card li')].find((item) => item.textContent!.includes('Rival'))!;
    expect(rival.textContent).toContain('Protest open');
    expect(rival.querySelector('button')).toBeNull();
  });

  it('requires a category, a detailed reason, and evidence before submitting', async () => {
    await render();
    startProtest('Rival Two');
    const component = fixture.componentInstance as any;
    const submit = () => element().querySelector<HTMLButtonElement>('.protest-form button[type="submit"]')!;
    expect(submit().disabled).toBe(true);
    component.protestForm.eligibilityCategory = 'Skill level eligibility';
    component.protestForm.reason = 'Too short';
    expect(component.canSubmitProtest()).toBe(false);
    component.protestForm.reason = reason;
    expect(component.canSubmitProtest()).toBe(false);
    component.submitProtest(element().querySelector('input[type="file"]'));
    expect(component.evidenceError()).toContain('Evidence is required');
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([
    [[new File(['x'], 'notes.txt', { type: 'text/plain' })], 'notes.txt is not allowed'],
    [[new File([], 'empty.pdf', { type: 'application/pdf' })], 'empty.pdf is not allowed'],
    [[new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })], 'big.png is not allowed'],
    [Array.from({ length: 6 }, (_, index) => new File(['x'], `e${index}.png`, { type: 'image/png' })), 'no more than 5'],
  ])('rejects invalid evidence selections', async (files, message) => {
    await render();
    startProtest('Rival');
    const input = selectEvidence(files);
    const component = fixture.componentInstance as any;
    expect(component.evidenceFiles()).toEqual([]);
    expect(input.value).toBe('');
    expect(element().textContent).toContain(message);
  });

  it('submits the protest as multipart form data with every evidence file', async () => {
    await render();
    startProtest('Rival Two');
    const component = fixture.componentInstance as any;
    const files = [
      new File(['png'], 'photo.png', { type: 'image/png' }),
      new File(['docx'], 'statement.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ];
    const input = selectEvidence(files);
    component.protestForm.eligibilityCategory = 'Skill level eligibility';
    component.protestForm.reason = `  ${reason}  `;
    const created = { protestId: 'p1', protestedMemberId: 'rival-2', protestedMemberName: 'Rival Two', status: 'Open',
      eligibilityCategory: 'Skill level eligibility', reason, evidence: [], createdAt: '2026-10-20' } as unknown as TournamentProtest;
    http.post.mockReturnValueOnce(of(created));
    component.submitProtest(input);

    expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/tournaments/event-1/protests'),
      expect.any(FormData), { withCredentials: true });
    const body = http.post.mock.calls[0][1] as FormData;
    expect(body.get('protestedMemberId')).toBe('rival-2');
    expect(body.get('eligibilityCategory')).toBe('Skill level eligibility');
    expect(body.get('reason')).toBe(reason);
    expect((body.getAll('evidence') as File[]).map((file) => file.name)).toEqual(['photo.png', 'statement.docx']);
    expect(component.protestTarget()).toBeNull();
    expect(component.protests()).toEqual([created]);
    expect(component.feedbackMessage()).toContain('Rival Two');
  });

  it('keeps the form open and shows API errors', async () => {
    await render();
    startProtest('Rival');
    const component = fixture.componentInstance as any;
    const input = selectEvidence([new File(['pdf'], 'proof.pdf', { type: 'application/pdf' })]);
    component.protestForm.eligibilityCategory = 'Other';
    component.protestForm.reason = reason;
    http.post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'You already have an open protest against this player.' },
    })));
    component.submitProtest(input);
    expect(component.errorMessage()).toBe('You already have an open protest against this player.');
    expect(component.protestTarget()?.memberId).toBe('rival');
    expect(component.evidenceFiles()).toHaveLength(1);
    expect(component.isSubmitting()).toBe(false);
  });

  it('shows why the roster is unavailable', async () => {
    http.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'The roster is available after registration closes.' },
    })));
    await render();
    expect(element().textContent).toContain('The roster is available after registration closes.');
  });
});
