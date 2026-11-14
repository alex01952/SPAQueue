import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { OpenPlayBoardPageComponent } from './open-play-board-page.component';
import { routes } from '../app.routes';
import { memberAuthGuard } from '../member-auth.guard';

describe('OpenPlayBoardPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpenPlayBoardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('allows authenticated members to access the board route', () => {
    const route = routes.find((entry) => entry.path === 'open-play-board');
    expect(route?.canActivate).toContain(memberAuthGuard);
    expect(route?.data?.['allowedRoles']).toBeUndefined();
  });

  it('hides player data when Open Play is not active', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSessionRefresh();
    http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
      active: false, regularLine: [], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null,
      activeCourts: [{ number: 1, name: 'Hidden court', startedAt: new Date().toISOString() }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.line-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('.active-courts')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Open Play is not active');
    fixture.destroy();
  });

  function player(id: string, line: 'normal' | 'winners' = 'normal') {
    return { id, name: `Player ${id}`, category: 'High Intermediate' as const, line, waitMs: 120000, wins: 3, losses: 1, games: 4, available: true, membershipType: id.startsWith('gold') ? 'gold-member' as const : id.startsWith('guest') ? 'non-member' as const : 'member' as const };
  }

  function flushSessionRefresh() {
    const request = http.expectOne((entry) => entry.url.endsWith('/members/session/refresh'));
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ authenticated: true });
  }

  it('ticks compact court timers from the saved game start without resetting on polls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:05:00Z'));
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const board = {
      active: true, regularLine: [], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null,
      activeCourts: [{ number: 1, name: 'Arena North', startedAt: '2026-11-12T10:00:00Z' }],
    };
    try {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      flushSessionRefresh();
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush(board);
      fixture.detectChanges();
      const strip = fixture.nativeElement.querySelector('.active-courts') as HTMLElement;
      expect(strip.querySelector('.court-name')?.textContent).toBe('Arena North');
      expect(strip.querySelector('[role="timer"]')?.textContent).toBe('05:00');
      expect(strip.querySelectorAll('.active-court')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();
      expect(strip.querySelector('[role="timer"]')?.textContent).toBe('05:01');
      await vi.advanceTimersByTimeAsync(4000);
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush(board);
      fixture.detectChanges();
      expect(strip.querySelector('[role="timer"]')?.textContent).toBe('05:05');
      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({ ...board, activeCourts: [] });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.active-courts')).toBeNull();
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(5000);
      http.expectNone((entry) => entry.url.endsWith('/open-play/board'));
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });

  it('formats long games and clamps invalid or future start times', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    component['now'].set(Date.parse('2026-11-12T11:02:03Z'));
    expect(component['courtElapsedTime']('2026-11-12T10:00:00Z')).toBe('1:02:03');
    expect(component['courtElapsedTime']('2026-11-12T12:00:00Z')).toBe('00:00');
    expect(component['courtElapsedTime']('invalid')).toBe('00:00');
    fixture.destroy();
  });

  it('shows both waiting groups and the admin-selected next players', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSessionRefresh();
    const request = http.expectOne((entry) => entry.url.endsWith('/open-play/board'));
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      active: true, regularLine: [player('one'), player('two')],
      winnersLine: [player('three', 'winners'), player('four', 'winners')],
      topFive: [{ id: 'one', name: 'Player one', wins: 3, losses: 1, games: 4, percent: 75, membershipType: 'member' }],
      playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null,
      nextPlayerIds: ['one', 'two', 'three', 'four'],
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(Array.from(root.querySelectorAll('section h2')).map((heading) => heading.textContent?.trim()))
      .toEqual(['Current Locks', 'Next to Play', 'On Deck', 'Regular Line', 'Winners Line', 'Top 5']);
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player one');
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player four');
    expect(fixture.nativeElement.querySelector('.next-player .silver-frame')).not.toBeNull();
    const teams = root.querySelectorAll('[aria-labelledby="next-players-heading"] .next-team');
    expect(teams).toHaveLength(2);
    expect(Array.from(teams[0].querySelectorAll('.next-player strong')).map((entry) => entry.textContent?.trim())).toEqual(['Player one', 'Player two']);
    expect(Array.from(teams[1].querySelectorAll('.next-player strong')).map((entry) => entry.textContent?.trim())).toEqual(['Player three', 'Player four']);
    expect(root.querySelector('.slot-label')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feed-state')?.textContent).toContain('Live');
    fixture.destroy();
  });

  it('shows lock groups including players on court and updates them with the board', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const board = {
      active: true, regularLine: [player('waiting')], winnersLine: [], topFive: [],
      playerLocks: [['waiting', 'playing'], ['other-1', 'other-2']],
      lockGroups: [[{ id: 'waiting', name: 'Player waiting' }, { id: 'playing', name: 'Player playing' }],
        [{ id: 'other-1', name: 'Other one' }, { id: 'other-2', name: 'Other two' }]],
      matchingMode: 'wait-priority' as const, forcedCategory: null, nextPlayerIds: null,
      activeCourts: [{ number: 1, name: 'Court 1', startedAt: '2026-11-12T10:00:00Z' }],
    };
    component['board'].set(board);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.board-activity .active-courts')).not.toBeNull();
    const groups = root.querySelectorAll('.lock-list li');
    expect(Array.from(groups).map((group) => group.textContent?.trim())).toEqual(['Player waiting, Player playing', 'Other one, Other two']);
    component['board'].set({ ...board, playerLocks: [], lockGroups: [], activeCourts: [] });
    fixture.detectChanges();
    expect(root.querySelector('.lock-list')).toBeNull();
    expect(root.querySelector('.locks-section')?.textContent).toContain('No players locked.');
    fixture.destroy();
  });

  it('uses waiting player names and a neutral fallback with older board responses', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.componentInstance['board'].set({
      active: true, regularLine: [player('waiting')], winnersLine: [], topFive: [],
      playerLocks: [['waiting', 'playing']], matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.lock-list')?.textContent).toContain('Player waiting, Name unavailable');
    fixture.destroy();
  });

  it('does not generate Next Players from the live board data', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSessionRefresh();
    http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
      active: true, regularLine: [player('one'), player('two'), player('three'), player('four')],
      winnersLine: [], topFive: [], playerLocks: [], matchingMode: 'wait-priority',
      forcedCategory: null, nextPlayerIds: null,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).not.toContain('Player one');
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).not.toContain('Player four');
    expect(fixture.nativeElement.querySelectorAll('.next-player')).toHaveLength(8);
    fixture.destroy();
  });

  it('labels regular members, Gold members, and non-members', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSessionRefresh();
    http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
      active: true, regularLine: [player('gold-player'), player('member-player')],
      winnersLine: [player('guest-player', 'winners')], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null,
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.player-list .gold-frame')).not.toBeNull();
    expect(root.querySelector('.player-list .silver-frame')).not.toBeNull();
    expect(root.querySelector('.player-list .membership-name-frame:not(.silver-frame):not(.gold-frame)')).toBeNull();
    fixture.destroy();
  });

  it('keeps two team boxes and preserves empty member slots in a partial lineup', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.componentInstance['board'].set({
      active: true, regularLine: [player('gold-one'), player('two')], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: ['gold-one', '', 'two', ''],
    });
    fixture.detectChanges();
    const teams = fixture.nativeElement.querySelectorAll('[aria-labelledby="next-players-heading"] .next-team') as NodeListOf<HTMLElement>;
    expect(teams).toHaveLength(2);
    expect(teams[0].getAttribute('aria-label')).toBe('Team 1');
    expect(teams[1].getAttribute('aria-label')).toBe('Team 2');
    expect(teams[0].querySelector('.gold-frame')).not.toBeNull();
    for (const team of teams) {
      expect(team.querySelectorAll('.next-player')).toHaveLength(2);
      expect(team.textContent).toContain('Open slot');
    }
    fixture.destroy();
  });

  it('keeps the published lineup despite queue, availability, wait, seed, and legacy secondary changes', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const players = Array.from({ length: 8 }, (_, index) => player(`stable-${index}`));
    const nextPlayerIds = players.slice(0, 4).map((entry) => entry.id);
    const board = {
      active: true, regularLine: players, winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority' as const, forcedCategory: null, nextPlayerIds,
      secondaryEnabled: true, secondaryNextPlayerIds: players.slice(4).map((entry) => entry.id),
    };
    component['board'].set(board);
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(nextPlayerIds);
    component['board'].set({ ...board, tieBreakSeed: 4321, regularLine: players.slice().reverse().map((entry) => ({ ...entry, waitMs: 3600000, available: false })) });
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(nextPlayerIds);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.secondary-next')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.next-player')).toHaveLength(8);
    component['board'].set({ ...board, regularLine: players.slice(1) });
    expect(component['nextPlayerSlots']().map((entry) => entry?.id ?? null)).toEqual([null, ...nextPlayerIds.slice(1)]);
    fixture.destroy();
  });

  it('shows both fixed groups and follows an explicitly published promotion', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const players = Array.from({ length: 12 }, (_, index) => player(`waiting-${index}`));
    const first = players.slice(0, 4).map((entry) => entry.id);
    const following = players.slice(4, 8).map((entry) => entry.id);
    const newGroup = players.slice(8).map((entry) => entry.id);
    const board = { active: true, regularLine: players, winnersLine: [], topFive: [], playerLocks: [], matchingMode: 'wait-priority' as const, forcedCategory: null, nextPlayerIds: first, followingPlayerIds: following };
    component['board'].set(board);
    fixture.detectChanges();
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(first);
    expect(component['followingPlayerSlots']().map((entry) => entry?.id)).toEqual(following);
    expect(fixture.nativeElement.querySelectorAll('.next-player')).toHaveLength(8);
    component['board'].set({ ...board, regularLine: players.slice().reverse().map((entry) => ({ ...entry, waitMs: 3600000 })) });
    expect(component['followingPlayerSlots']().map((entry) => entry?.id)).toEqual(following);
    component['board'].set({ ...board, regularLine: players.slice(4), nextPlayerIds: following, followingPlayerIds: newGroup });
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(following);
    expect(component['followingPlayerSlots']().map((entry) => entry?.id)).toEqual(newGroup);
    fixture.destroy();
  });

  it('renews an idle session every fifteen minutes, recovers after errors, and stops when closed', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const flushBoardPolls = () => {
      for (const request of http.match((entry) => entry.url.endsWith('/open-play/board'))) {
        if (!request.cancelled) request.flush({
          active: false, regularLine: [], winnersLine: [], topFive: [], playerLocks: [],
          matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null,
        });
      }
    };
    try {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      flushSessionRefresh();
      flushBoardPolls();

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      const failed = http.expectOne((entry) => entry.url.endsWith('/members/session/refresh'));
      failed.flush({}, { status: 503, statusText: 'Service Unavailable' });
      flushBoardPolls();

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      flushSessionRefresh();
      flushBoardPolls();

      fixture.destroy();
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      http.expectNone((entry) => entry.url.endsWith('/members/session/refresh') || entry.url.endsWith('/open-play/board'));
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });

  it('polls for saved Next Players updates without a page reload', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    try {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      flushSessionRefresh();
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
        active: true, regularLine: [player('one'), player('two'), player('three'), player('four')],
        winnersLine: [], topFive: [], playerLocks: [], matchingMode: 'wait-priority',
        forcedCategory: null, nextPlayerIds: ['one', 'two', 'three', 'four'],
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player one');

      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
        active: true, regularLine: [player('high-one'), player('high-two')],
        winnersLine: [{ ...player('intermediate-one', 'winners'), category: 'Intermediate' }, { ...player('intermediate-two', 'winners'), category: 'Intermediate' }],
        topFive: [], playerLocks: [], matchingMode: 'wait-priority',
        forcedCategory: 'High Intermediate', nextPlayerIds: ['high-one', 'high-two', 'intermediate-one', 'intermediate-two'],
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player high-one');
      expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player intermediate-one');
      expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).not.toContain('Player one');
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });
});