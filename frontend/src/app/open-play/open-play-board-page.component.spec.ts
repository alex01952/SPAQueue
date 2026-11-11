import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { OpenPlayBoardPageComponent } from './open-play-board-page.component';
import { suggestNextOpenPlayMatch } from './open-play-matching';
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
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.line-grid')).toBeNull();
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

  it('shows only the four requested sections and the admin-selected next players', async () => {
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
      .toEqual(['Automatic', 'Regular Line', 'Winners Line', 'Top 5']);
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player one');
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player four');
    expect(fixture.nativeElement.querySelector('.next-player .silver-frame')).not.toBeNull();
    const teams = root.querySelectorAll('.next-grid .next-team');
    expect(teams).toHaveLength(2);
    expect(Array.from(teams[0].querySelectorAll('.next-player strong')).map((entry) => entry.textContent?.trim())).toEqual(['Player one', 'Player two']);
    expect(Array.from(teams[1].querySelectorAll('.next-player strong')).map((entry) => entry.textContent?.trim())).toEqual(['Player three', 'Player four']);
    expect(root.querySelector('.slot-label')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feed-state')?.textContent).toContain('Live');
    fixture.destroy();
  });

  it('computes automatic Next Players from the live board data', async () => {
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

    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player one');
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player four');
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

  it('shows a second forced-category lineup without reusing the primary players or splitting the shared lines', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const intermediate = Array.from({ length: 4 }, (_, index) => ({ ...player(`intermediate-${index}`), category: 'Intermediate' as const }));
    const high = Array.from({ length: 4 }, (_, index) => player(`high-${index}`));
    const board = {
      active: true, regularLine: [...intermediate, ...high], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority' as const, forcedCategory: 'Intermediate' as const, nextPlayerIds: null,
      secondaryEnabled: true, secondaryForcedCategory: 'High Intermediate' as const,
    };
    component['board'].set(board);
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(expect.arrayContaining(intermediate.map((entry) => entry.id)));
    expect(component['secondaryPlayerSlots']().map((entry) => entry?.id)).toEqual(expect.arrayContaining(high.map((entry) => entry.id)));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.secondary-next .next-player')).toHaveLength(4);
    expect(fixture.nativeElement.querySelectorAll('.secondary-next .next-team')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.suggestion-grid .next-team')).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('.suggestion-grid.dual > section[aria-labelledby="next-players-heading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.suggestion-grid.dual > .secondary-next')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.suggestion-grid .next-player')).toHaveLength(8);
    expect(fixture.nativeElement.querySelector('.secondary-next')?.textContent).toContain('High Intermediate');
    expect(component['board']()?.regularLine).toHaveLength(8);
    component['board'].set({ ...board, nextPlayerIds: high.map((entry) => entry.id) });
    expect(component['secondaryPlayerSlots']().some((entry) => entry && high.some((player) => player.id === entry.id))).toBe(false);
    component['board'].set({ ...board, secondaryEnabled: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.secondary-next')).toBeNull();
    expect(fixture.nativeElement.querySelector('.suggestion-grid')?.classList.contains('dual')).toBe(false);
    fixture.destroy();
  });

  it.each([
    { primary: null, secondary: 'High Intermediate' as const },
    { primary: 'Intermediate' as const, secondary: null },
    { primary: null, secondary: null },
  ])('labels lineups by their selected categories: $primary and $secondary', ({ primary, secondary }) => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.componentInstance['board'].set({
      active: true, regularLine: [], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: primary, nextPlayerIds: null,
      secondaryEnabled: true, secondaryForcedCategory: secondary,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#next-players-heading')?.textContent.trim()).toBe(primary ?? 'Automatic');
    expect(fixture.nativeElement.querySelector('#secondary-next-players-heading')?.textContent.trim()).toBe(secondary ?? 'Automatic');
    fixture.destroy();
  });

  it('keeps two team boxes and preserves empty member slots in a partial lineup', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.componentInstance['board'].set({
      active: true, regularLine: [player('gold-one'), player('two')], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: ['gold-one', '', 'two', ''],
    });
    fixture.detectChanges();
    const teams = fixture.nativeElement.querySelectorAll('.next-team') as NodeListOf<HTMLElement>;
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

  it('shows and hides the secondary lineup on live polling updates without reloading the board', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const intermediate = Array.from({ length: 4 }, (_, index) => ({ ...player(`intermediate-${index}`), category: 'Intermediate' as const }));
    const high = Array.from({ length: 4 }, (_, index) => player(`high-${index}`));
    const board = {
      active: true, regularLine: [...intermediate, ...high], winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: 'Intermediate', nextPlayerIds: intermediate.map((entry) => entry.id),
      secondaryEnabled: false, secondaryForcedCategory: null, secondaryNextPlayerIds: null,
    };
    try {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      flushSessionRefresh();
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush(board);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.secondary-next')).toBeNull();

      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush({
        ...board, secondaryEnabled: true, secondaryForcedCategory: 'High Intermediate', secondaryNextPlayerIds: high.map((entry) => entry.id),
      });
      fixture.detectChanges();
      const secondary = fixture.nativeElement.querySelector('.secondary-next') as HTMLElement;
      expect(secondary).not.toBeNull();
      expect(secondary.querySelectorAll('.next-player')).toHaveLength(4);
      high.forEach((entry) => expect(secondary.textContent).toContain(entry.name));
      expect(secondary.textContent).toContain('High Intermediate');

      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne((entry) => entry.url.endsWith('/open-play/board')).flush(board);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.secondary-next')).toBeNull();
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });

  it('uses the shared tie-break seed to display one complete line followed by the other', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const regularLine = Array.from({ length: 4 }, (_, index) => player(`tied-regular-${index}`));
    const winnersLine = Array.from({ length: 4 }, (_, index) => player(`tied-winner-${index}`, 'winners'));
    for (let tieBreakSeed = 0; tieBreakSeed < 10; tieBreakSeed++) {
      component['board'].set({
        active: true, regularLine, winnersLine, topFive: [], playerLocks: [], matchingMode: 'wait-priority',
        forcedCategory: null, secondaryEnabled: true, secondaryForcedCategory: null, nextPlayerIds: null, tieBreakSeed,
      });
      const expected = suggestNextOpenPlayMatch([...regularLine, ...winnersLine], 'wait-priority', [], null, [], tieBreakSeed)!;
      expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(expected.teams.flat().map((entry) => entry.id));
      const primaryLine = component['nextPlayerSlots']()[0]!.line;
      expect(component['nextPlayerSlots']().every((entry) => entry?.line === primaryLine)).toBe(true);
      expect(component['secondaryPlayerSlots']().every((entry) => entry && entry.line !== primaryLine)).toBe(true);
    }
    fixture.destroy();
  });

  it('keeps the other lineup unchanged when only primary or secondary suggestions are refreshed', () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    const component = fixture.componentInstance;
    const players = Array.from({ length: 12 }, (_, index) => player(`same-category-${index}`));
    const secondary = players.slice(4, 8).map((entry) => entry.id);
    const board = {
      active: true, regularLine: players, winnersLine: [], topFive: [], playerLocks: [],
      matchingMode: 'wait-priority' as const, forcedCategory: null, nextPlayerIds: null,
      secondaryEnabled: true, secondaryForcedCategory: null, secondaryNextPlayerIds: secondary,
    };
    component['board'].set(board);
    expect(component['secondaryPlayerSlots']().map((entry) => entry?.id)).toEqual(secondary);
    const reordered = [...players.slice(8), ...players.slice(0, 8)];
    component['board'].set({ ...board, regularLine: reordered });
    const primary = component['nextPlayerSlots']().map((entry) => entry!.id);
    expect(primary).toEqual(expect.arrayContaining(players.slice(8).map((entry) => entry.id)));
    expect(component['secondaryPlayerSlots']().map((entry) => entry?.id)).toEqual(secondary);
    component['board'].set({ ...board, regularLine: reordered, nextPlayerIds: primary, secondaryNextPlayerIds: null });
    expect(component['nextPlayerSlots']().map((entry) => entry?.id)).toEqual(primary);
    expect(component['secondaryPlayerSlots']().map((entry) => entry?.id)).toEqual(expect.arrayContaining(players.slice(0, 4).map((entry) => entry.id)));
    expect(component['secondaryPlayerSlots']().some((entry) => entry && primary.includes(entry.id))).toBe(false);
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
        forcedCategory: 'High Intermediate', nextPlayerIds: null,
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