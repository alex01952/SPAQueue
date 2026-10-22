import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TournamentLiveDrawPageComponent } from './tournament-live-draw-page.component';
import type { LiveDrawPhase, TournamentLiveDrawState } from './tournament.types';

describe('TournamentLiveDrawPageComponent', () => {
  let fixture: ComponentFixture<TournamentLiveDrawPageComponent>;
  let http: HttpTestingController;
  let state: TournamentLiveDrawState;
  const start = Date.parse('2026-10-23T10:00:00Z');
  const iso = (at: number) => new Date(at).toISOString();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TournamentLiveDrawPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ tournamentId: 'event-1' }) } } },
      ],
    }).compileComponents();
    vi.useFakeTimers();
    vi.setSystemTime(start - 60_000);
    state = {
      serverNow: iso(Date.now()), canManage: false, event: null,
      roster: {
        tournamentId: 'event-1', tournamentName: 'Club Open', category: 'Mixed Doubles',
        level: 'Beginner', canManageRoster: false,
        teams: ['a', 'b', 'c', 'd'].map((id) => ({
          registrationId: `team-${id}`, status: 'Paid', isOwnTeam: false,
          players: [{ memberId: id, name: `Player ${id}`, gender: 'Male' }],
        })),
      },
    };
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TournamentLiveDrawPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function event(phase: LiveDrawPhase, endsAt: number | null) {
    state.event = {
      eventId: 'draw-1', scheduledAt: iso(start), phase, phaseEndsAt: endsAt === null ? null : iso(endsAt),
      poolCount: 2, attendeeCount: 3, eligibleCount: phase === 'scheduled' ? null : 3,
      majorityRequired: phase === 'scheduled' ? null : 2,
      hasVoted: false, canVote: phase === 'voting', pools: null, voteResult: null,
    };
  }
  function flushPresence() {
    const request = http.expectOne((item) => item.url.endsWith('/live-draw/presence'));
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    request.flush(structuredClone(state));
    fixture.detectChanges();
  }
  const text = () => (fixture.nativeElement as HTMLElement).textContent!;

  it('records presence with credentials, shows a countdown, and hides votes/assignments until revealed', () => {
    event('scheduled', start);
    flushPresence();
    expect(text()).toContain('00:01:00');
    expect(text()).toContain('3 players currently present');
    expect(text()).not.toContain('Vote results:');
    expect(fixture.nativeElement.querySelector('.pools')).toBeNull();
    expect(fixture.nativeElement.querySelector('.admin-panel')).toBeNull();
  });

  it('adjusts its countdown to the server clock rather than trusting the browser clock', () => {
    state.serverNow = iso(start - 30_000);
    event('scheduled', start);
    flushPresence();
    expect(text()).toContain('00:00:30');
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(text()).toContain('00:00:29');
  });

  it('allows API loads slower than ten seconds to complete and show the admin scheduling form', () => {
    const request = http.expectOne((item) => item.url.endsWith('/presence'));
    vi.advanceTimersByTime(11_000);
    expect(request.cancelled).toBe(false);
    state.canManage = true;
    state.serverNow = iso(Date.now());
    request.flush(state);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.admin-panel')).not.toBeNull();
    expect(fixture.componentInstance['connected']()).toBe(true);
    expect(fixture.componentInstance['error']()).toBe('');
  });

  it('explains API timeouts, retains the scheduling form and clears the error after recovery', () => {
    state.canManage = true;
    flushPresence();
    fixture.componentInstance['refresh']();
    const request = http.expectOne((item) => item.url.endsWith('/presence'));
    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(request.cancelled).toBe(true);
    expect(text()).toContain('did not respond within 30 seconds');
    expect(fixture.nativeElement.querySelector('.admin-panel')).not.toBeNull();
    expect(fixture.componentInstance['connected']()).toBe(false);
    vi.advanceTimersByTime(4000);
    state.serverNow = iso(Date.now());
    flushPresence();
    expect(fixture.componentInstance['error']()).toBe('');
    expect(fixture.componentInstance['connected']()).toBe(true);
  });

  it('distinguishes network failures from API response errors', () => {
    http.expectOne((item) => item.url.endsWith('/presence')).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain('Cannot reach the live draw API');
    fixture.componentInstance['refresh']();
    http.expectOne((item) => item.url.endsWith('/presence')).flush('Unavailable', { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();
    expect(text()).toContain('HTTP 503');
  });

  it('refreshes at phase boundaries rather than waiting another polling interval', () => {
    vi.setSystemTime(start - 500);
    state.serverNow = iso(Date.now());
    event('scheduled', start);
    flushPresence();
    vi.advanceTimersByTime(600);
    event('revealing', start + 10_000);
    state.serverNow = iso(Date.now());
    flushPresence();
    expect(fixture.nativeElement.querySelector('[data-phase="revealing"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.draw-animation')).not.toBeNull();
  });

  it('reveals vote totals and decision before any reroll animation and keeps them visible afterwards', () => {
    vi.setSystemTime(start + 70_000);
    state.serverNow = iso(Date.now());
    event('results', start + 80_000);
    state.event!.voteResult = { rerollVotes: 2, didNotVote: 1, reroll: true };
    state.event!.pools = [{ number: 1, registrationIds: ['team-a', 'team-b'] }];
    flushPresence();
    expect(text()).toContain('Vote results: Reroll approved');
    expect(text()).toContain('2 voted to reroll');
    expect(text()).toContain('The reroll will begin');
    expect(text()).toContain('Player a');
    expect(fixture.nativeElement.querySelector('.draw-animation')).toBeNull();
    vi.advanceTimersByTime(9000);
    const pending = http.match((item) => item.url.endsWith('/presence'));
    expect(pending.length).toBe(1);
    event('results', start + 80_000);
    state.event!.voteResult = { rerollVotes: 2, didNotVote: 1, reroll: true };
    state.serverNow = iso(Date.now());
    pending[0].flush(structuredClone(state));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.draw-animation')).toBeNull();
    vi.advanceTimersByTime(1100);
    event('rerolling', start + 90_000);
    state.event!.voteResult = { rerollVotes: 2, didNotVote: 1, reroll: true };
    state.serverNow = iso(Date.now());
    flushPresence();
    expect(text()).toContain('single reroll is underway');
    expect(text()).toContain('Vote results: Reroll approved');
    expect(fixture.nativeElement.querySelector('.pools')).toBeNull();
  });

  it('shows the no-reroll decision before final pools and never offers another voting round', () => {
    event('results', start + 80_000);
    state.event!.voteResult = { rerollVotes: 1, didNotVote: 2, reroll: false };
    flushPresence();
    expect(text()).toContain('No reroll');
    expect(text()).toContain('The first draw will become final');
    expect(text()).not.toContain('Final pools saved');
    fixture.componentInstance['refresh']();
    event('final', null);
    state.event!.voteResult = { rerollVotes: 1, didNotVote: 2, reroll: false };
    state.event!.pools = [{ number: 1, registrationIds: ['team-a', 'team-b'] }];
    flushPresence();
    expect(text()).toContain('Final pools saved');
    expect(text()).toContain('Vote results: No reroll');
    expect(text()).not.toContain('Use my one vote');
  });

  it('casts exactly one event-specific vote, disables duplicate submissions and restores its acknowledgement', () => {
    vi.setSystemTime(start + 10_000);
    state.serverNow = iso(Date.now());
    event('voting', start + 70_000);
    flushPresence();
    fixture.componentInstance['vote']();
    fixture.componentInstance['vote']();
    const request = http.expectOne((item) => item.url.endsWith('/live-draw/vote'));
    expect(request.request.body).toEqual({ eventId: 'draw-1' });
    expect(request.request.withCredentials).toBe(true);
    state.event!.hasVoted = true;
    state.event!.canVote = false;
    request.flush(state);
    fixture.detectChanges();
    expect(text()).toContain('Your one reroll vote has been recorded.');
    expect(text()).not.toContain('Vote results:');
    fixture.componentInstance['vote']();
    http.expectNone((item) => item.url.endsWith('/vote'));
    fixture.componentInstance['refresh']();
    flushPresence();
    expect(text()).toContain('Reroll vote recorded');
  });

  it('lets late arrivals watch but not vote and stops voting at the local server-adjusted deadline', () => {
    vi.setSystemTime(start + 69_000);
    state.serverNow = iso(Date.now());
    event('voting', start + 70_000);
    state.event!.canVote = false;
    flushPresence();
    expect(text()).toContain('You may watch, but cannot vote.');
    fixture.componentInstance['vote']();
    http.expectNone((item) => item.url.endsWith('/vote'));
    state.event!.canVote = true;
    fixture.componentInstance['refresh']();
    flushPresence();
    vi.advanceTimersByTime(1000);
    fixture.componentInstance['vote']();
    http.expectNone((item) => item.url.endsWith('/vote'));
  });

  it('schedules the finalized roster with selected pools and explicit replacement confirmation', () => {
    state.canManage = true;
    flushPresence();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.componentInstance['scheduledAt'] = iso(start + 120_000);
    fixture.componentInstance['poolCount'] = 2;
    fixture.componentInstance['rosterFinalized'] = true;
    fixture.componentInstance['schedule']();
    const request = http.expectOne((item) => item.url.includes('/admin/tournaments/event-1/live-draw'));
    expect(request.request.body).toEqual({
      scheduledAt: iso(start + 120_000), poolCount: 2, rosterFinalized: true, expectedEventId: null,
    });
    event('scheduled', start + 120_000);
    request.flush(state);
    fixture.detectChanges();
    expect(text()).toContain('Live draw scheduled.');
  });

  it('does not schedule invalid settings or replace a draw without confirmation', () => {
    state.canManage = true;
    flushPresence();
    fixture.componentInstance['schedule']();
    expect(fixture.componentInstance['error']()).toContain('Confirm the finalized roster');
    fixture.componentInstance['scheduledAt'] = iso(start + 120_000);
    fixture.componentInstance['rosterFinalized'] = true;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance['schedule']();
    http.expectNone((item) => item.url.includes('/admin/'));
  });

  it('surfaces failed votes, disables voting while disconnected, and reconnects without claiming success', () => {
    event('voting', start + 70_000);
    flushPresence();
    fixture.componentInstance['vote']();
    http.expectOne((item) => item.url.endsWith('/vote')).flush({ message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(text()).toContain('Storage unavailable');
    expect(text()).not.toContain('Your one reroll vote has been recorded.');
    fixture.componentInstance['vote']();
    http.expectNone((item) => item.url.endsWith('/vote'));
    vi.advanceTimersByTime(4000);
    flushPresence();
    expect(text()).not.toContain('Storage unavailable');
    expect(fixture.componentInstance['connected']()).toBe(true);
  });

  it('cancels requests and polling when destroyed and stops retrying forbidden access', () => {
    http.expectOne((item) => item.url.endsWith('/presence')).flush({ message: 'Participants only' }, { status: 403, statusText: 'Forbidden' });
    vi.advanceTimersByTime(5000);
    http.expectNone((item) => item.url.endsWith('/presence'));
    fixture.componentInstance['refresh']();
    const pending = http.expectOne((item) => item.url.endsWith('/presence'));
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
    vi.advanceTimersByTime(10_000);
    http.expectNone((item) => item.url.endsWith('/presence'));
  });
});
