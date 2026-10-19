import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { TournamentProtest } from './tournament.types';
import { TournamentProtestsPageComponent } from './tournament-protests-page.component';

function protest(overrides: Partial<TournamentProtest>): TournamentProtest {
  return {
    tournamentId: 'event-1', protestId: 'p1', tournamentName: 'Club Open', protesterId: 'me', protesterName: 'Me',
    protesterRegistrationId: 'own', protestedMemberId: 'rival', protestedMemberName: 'Rival',
    protestedRegistrationId: 'other', eligibilityCategory: 'Gender requirement',
    reason: 'Detailed reason for the protest goes here.', status: 'Open', createdAt: '2026-10-20',
    evidence: [{ fileName: 'photo.png', contentType: 'image/png', size: 10, uploadedAt: '2026-10-20',
      url: '/tournaments/event-1/protests/p1/evidence/0' }],
    ...overrides,
  };
}

describe('TournamentProtestsPageComponent', () => {
  let fixture: ComponentFixture<TournamentProtestsPageComponent>;
  const items = [
    protest({}),
    protest({ protestId: 'p2', protestedMemberName: 'Second', status: 'Dismissed', reviewedAt: '2026-10-21', reviewNote: 'No proof.' }),
    protest({ protestId: 'p3', tournamentId: 'event-2', tournamentName: 'City Cup', protestedMemberName: 'Third' }),
  ];
  const http = {
    get: vi.fn((_url: string, _options: unknown) => of(items)),
    patch: vi.fn((_url: string, _body: unknown, _options: unknown) => of({} as TournamentProtest)),
  };

  async function render(tournamentId = '') {
    vi.restoreAllMocks();
    http.patch.mockReset();
    await TestBed.configureTestingModule({
      imports: [TournamentProtestsPageComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(tournamentId ? { tournamentId } : {}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentProtestsPageComponent);
    fixture.detectChanges();
  }

  function names(): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.protest-card strong')].map((item) => item.textContent!);
  }

  it('shows open protests with evidence links by default and filters by status', async () => {
    await render();
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/admin/tournament-protests'), { withCredentials: true });
    expect(names()).toEqual(['Me protested Rival', 'Me protested Third']);
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.evidence-links a')!;
    expect(link.href).toContain('/tournaments/event-1/protests/p1/evidence/0');
    expect(link.target).toBe('_blank');
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.status-filters button')];
    buttons.find((button) => button.textContent!.trim() === 'Dismissed')!.click();
    fixture.detectChanges();
    expect(names()).toEqual(['Me protested Second']);
    expect(fixture.nativeElement.textContent).toContain('No proof.');
    buttons.find((button) => button.textContent!.trim() === 'All')!.click();
    fixture.detectChanges();
    expect(names()).toHaveLength(3);
  });

  it('applies the tournament filter from the query string', async () => {
    await render('event-2');
    expect(names()).toEqual(['Me protested Third']);
  });

  it('upholds a protest with a trimmed review note', async () => {
    await render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const component = fixture.componentInstance as any;
    component.reviewNotes.p1 = '  Confirmed by evidence.  ';
    http.patch.mockReturnValueOnce(of(protest({ status: 'Upheld', reviewedAt: '2026-10-22', reviewNote: 'Confirmed by evidence.' })));
    component.review(items[0], 'Upheld');
    expect(http.patch).toHaveBeenCalledWith(expect.stringContaining('/admin/tournaments/event-1/protests/p1'),
      { status: 'Upheld', note: 'Confirmed by evidence.' }, { withCredentials: true });
    fixture.detectChanges();
    expect(component.feedbackMessage()).toBe('Protest against Rival marked Upheld.');
    expect(names()).toEqual(['Me protested Third']);
  });

  it('does not review without confirmation and surfaces API errors', async () => {
    await render();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const component = fixture.componentInstance as any;
    component.review(items[0], 'Dismissed');
    expect(http.patch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    http.patch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'This protest has already been reviewed.' },
    })));
    component.review(items[0], 'Dismissed');
    expect(component.errorMessage()).toBe('This protest has already been reviewed.');
    expect(component.workingProtestId()).toBe('');
  });
});
