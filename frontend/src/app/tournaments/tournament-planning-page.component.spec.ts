import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TournamentPlanningPageComponent } from './tournament-planning-page.component';
import type { TournamentPlanningState } from './tournament.types';

describe('TournamentPlanningPageComponent', () => {
  let fixture: ComponentFixture<TournamentPlanningPageComponent>;
  let http: HttpTestingController;
  let state: TournamentPlanningState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TournamentPlanningPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: convertToParamMap({ tournamentId: 'event-1' }) },
        } },
      ],
    }).compileComponents();
    state = {
      roster: {
        tournamentId: 'event-1', tournamentName: 'Club Open',
        category: 'Team Tournament', level: 'Beginner', canManageRoster: true,
        teams: Array.from({ length: 4 }, (_, index) => ({
          registrationId: `team-${index}`, status: 'Paid', isOwnTeam: false,
          players: Array.from({ length: 4 }, (_, player) => ({
            memberId: `player-${index}-${player}`, name: `Player ${index}-${player}`,
            gender: player < 2 ? 'Male' : 'Female',
          })),
        })),
      },
      draw: null, version: null, rosterChanged: false,
    };
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TournamentPlanningPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function flushLoad() {
    http.expectOne((request) => request.method === 'GET' && request.url.endsWith('/planning')).flush(state);
    fixture.detectChanges();
  }

  function savedState(): TournamentPlanningState {
    return {
      ...state, version: 'draw-1',
      draw: {
        version: 'draw-1', rosterSignature: 'signature', courtCount: 2,
        pools: [
          { number: 1, registrationIds: ['team-0', 'team-1'] },
          { number: 2, registrationIds: ['team-2', 'team-3'] },
        ],
        schedule: [],
        updatedAt: '2026-10-21T12:00:00Z', updatedBy: 'admin',
      },
    };
  }

  it('starts from intact confirmed teams without player matching or manual imports', () => {
    flushLoad();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Participating teams (4)');
    expect(element.textContent).toContain('Player 0-0 + Player 0-1 + Player 0-2 + Player 0-3');
    expect(element.textContent).not.toContain('Randomize teams');
    expect(element.querySelector('textarea')).toBeNull();
    expect(element.querySelector('#schedule-title')).toBeNull();
  });

  it('saves randomized pools and then generates and saves the schedule with selected courts', () => {
    flushLoad();
    fixture.componentInstance['poolCount'] = 2;
    fixture.componentInstance['randomizePools']();
    const request = http.expectOne((item) => item.url.endsWith('/planning/pools'));
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({ poolCount: 2, version: null });
    request.flush(savedState());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.pool-card')).toHaveLength(2);
    fixture.componentInstance['courtCount'] = 3;
    fixture.componentInstance['generateSchedule']();
    const scheduleRequest = http.expectOne((item) => item.url.endsWith('/planning/schedule'));
    expect(scheduleRequest.request.body).toEqual({ courtCount: 3, version: 'draw-1' });
    scheduleRequest.flush({
      ...savedState(),
      draw: {
        ...savedState().draw!, courtCount: 3,
        schedule: [{ number: 1, matches: [{
          courtNumber: 1, poolNumber: 1, teamOneId: 'team-0', teamTwoId: 'team-1',
        }] }],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Time slot 1');
    expect(fixture.nativeElement.textContent).toContain('Court 1');
    expect(fixture.nativeElement.textContent).toContain('Match schedule saved.');
  });

  it('restores saved pool and court settings on load', () => {
    state = savedState();
    flushLoad();
    expect(fixture.componentInstance['poolCount']).toBe(2);
    expect(fixture.componentInstance['courtCount']).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.pool-card')).toHaveLength(2);
  });

  it('rejects invalid counts and disables actions during saving', () => {
    flushLoad();
    fixture.componentInstance['poolCount'] = 3;
    fixture.componentInstance['randomizePools']();
    http.expectNone((item) => item.method === 'POST');
    fixture.componentInstance['poolCount'] = 2;
    fixture.componentInstance['randomizePools']();
    const request = http.expectOne((item) => item.method === 'POST');
    fixture.detectChanges();
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    fixture.componentInstance['randomizePools']();
    http.expectNone((item) => item.method === 'POST');
    request.flush(savedState());
  });

  it('requires confirmation before discarding an existing draw', () => {
    state = savedState();
    flushLoad();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance['randomizePools']();
    http.expectNone((item) => item.method === 'POST');
  });

  it('warns when the saved draw was invalidated by roster changes', () => {
    state.rosterChanged = true;
    state.version = 'old-draw';
    flushLoad();
    expect(fixture.nativeElement.textContent).toContain('participating roster has changed');
    expect(fixture.nativeElement.querySelector('#schedule-title')).toBeNull();
  });

  it('shows API conflicts without losing the currently displayed draw', () => {
    state = savedState();
    flushLoad();
    fixture.componentInstance['generateSchedule']();
    http.expectOne((item) => item.method === 'POST').flush(
      { message: 'The saved draw changed. Reload before making changes.' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('The saved draw changed');
    expect(fixture.componentInstance['saving']()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.pool-card')).toHaveLength(2);
  });
});
