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
    return { id, name: `Player ${id}`, category: 'High Intermediate', line, waitMs: 120000, wins: 3, losses: 1, games: 4, available: true, membershipType: id.startsWith('gold') ? 'gold-member' as const : id.startsWith('guest') ? 'non-member' as const : 'member' as const };
  }

  it('shows only the four requested sections and the admin-selected next players', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      .toEqual(['Next Players', 'Regular Line', 'Winners Line', 'Top 5']);
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player one');
    expect(fixture.nativeElement.querySelector('.next-grid')?.textContent).toContain('Player four');
    expect(fixture.nativeElement.querySelector('.next-player .silver-frame')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.feed-state')?.textContent).toContain('Live');
    fixture.destroy();
  });

  it('computes automatic Next Players from the live board data', async () => {
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('polls for saved Next Players updates without a page reload', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(OpenPlayBoardPageComponent);
    try {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
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