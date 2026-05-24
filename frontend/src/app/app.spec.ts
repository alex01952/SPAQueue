import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  let httpTestingController: HttpTestingController;

  function expectDefaultQueueRequest() {
    return httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=queue-line&matchingMode=dupr-balance',
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    const request = expectDefaultQueueRequest();
    request.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });
    expect(app).toBeTruthy();
  });

  it('should render the dashboard heading', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const request = expectDefaultQueueRequest();
    request.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Run the next game without double-booking the court.',
    );
  });

  it('should move completed games from live courts into history even when the round is still ongoing', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const request = expectDefaultQueueRequest();
    request.flush({
      players: [],
      ongoingRounds: [
        {
          id: 3,
          roundNumber: 3,
          status: 'ongoing',
          createdAt: '2026-05-24T05:30:45.053Z',
          completedAt: null,
          games: [
            {
              id: 3,
              courtNumber: 1,
              status: 'completed',
              createdAt: '2026-05-24T05:30:45.053Z',
              completedAt: '2026-05-24T05:31:35.999Z',
              score: { team1: 11, team2: 2 },
              players: [],
              teams: [
                { name: 'Team 1', players: [{ id: 1, name: 'Alex', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 }, { id: 2, name: 'Sam', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 }] },
                { name: 'Team 2', players: [{ id: 3, name: 'Casey', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 }, { id: 4, name: 'Jordan', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 }] },
              ],
            },
            {
              id: 4,
              courtNumber: 2,
              status: 'ongoing',
              createdAt: '2026-05-24T05:30:45.053Z',
              completedAt: null,
              score: null,
              players: [],
              teams: [
                { name: 'Team 1', players: [{ id: 5, name: 'Taylor', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: true, recentGamesPlayed: 0 }, { id: 6, name: 'Riley', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: true, recentGamesPlayed: 0 }] },
                { name: 'Team 2', players: [{ id: 7, name: 'Morgan', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: true, recentGamesPlayed: 0 }, { id: 8, name: 'Quinn', dupr: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: null, isPlaying: true, recentGamesPlayed: 0 }] },
              ],
            },
          ],
        },
      ],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const cards = Array.from(compiled.querySelectorAll<HTMLElement>('.card'));
    const liveCourts = cards.find((card) => card.querySelector('h2')?.textContent?.includes('Ongoing rounds'));
    const history = cards.find((card) => card.querySelector('h2')?.textContent?.includes('Recent rounds'));

    expect(liveCourts?.textContent).toContain('Court 2');
    expect(liveCourts?.textContent).not.toContain('Court 1');
    expect(history?.textContent).toContain('Court 1');
    expect(history?.textContent).toContain('11 - 2');
  });

  it('should filter the player roster with the search field', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const request = expectDefaultQueueRequest();
    request.flush({
      players: [
        { id: 1, name: 'Alex', dupr: 3.5, skillLevel: 'High Intermediate', isReady: true, checkedInAt: null, isPlaying: false, recentGamesPlayed: 1 },
        { id: 2, name: 'Jordan', dupr: 4.2, skillLevel: 'Advanced', isReady: false, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 },
      ],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const searchInput = compiled.querySelector<HTMLInputElement>('input[type="search"]');

    searchInput!.value = 'alex';
    searchInput!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rosterCard = Array.from(compiled.querySelectorAll<HTMLElement>('.card')).find(
      (card) => card.querySelector('h2')?.textContent?.includes('Check players in or out'),
    );

    expect(rosterCard?.textContent).toContain('Alex');
    expect(rosterCard?.textContent).not.toContain('Jordan');
    expect(rosterCard?.textContent).toContain('1 shown');
  });

  it('should request a new snapshot when the queue mode changes', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = compiled.querySelectorAll<HTMLSelectElement>('select');
    const queueModeSelect = selects[1];

    queueModeSelect.value = 'check-in-order';
    queueModeSelect.dispatchEvent(new Event('change'));

    const modeRequest = httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=check-in-order&matchingMode=dupr-balance',
    );

    modeRequest.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'check-in-order',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(queueModeSelect.value).toBe('check-in-order');
    expect(compiled.textContent).toContain('Check-in order');
  });

  it('should request a least-played-first snapshot when that queue mode is selected', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = compiled.querySelectorAll<HTMLSelectElement>('select');
    const queueModeSelect = selects[1];

    queueModeSelect.value = 'least-played-first';
    queueModeSelect.dispatchEvent(new Event('change'));

    const modeRequest = httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=least-played-first&matchingMode=dupr-balance',
    );

    modeRequest.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'least-played-first',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(queueModeSelect.value).toBe('least-played-first');
    expect(compiled.textContent).toContain('Least played first');
  });

  it('should show skill levels in suggested teams and the eligible queue', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [
          { id: 1, name: 'Alex', dupr: 3.5, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
          { id: 2, name: 'Jordan', dupr: 4.2, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 3, name: 'Casey', dupr: null, skillLevel: 'Beginner', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 4, name: 'Morgan', dupr: 3.1, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 2 },
          { id: 5, name: 'Taylor', dupr: 2.9, skillLevel: 'Novice', isReady: true, checkedInAt: '2026-05-24T06:04:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
        ],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const previewCard = Array.from(compiled.querySelectorAll<HTMLElement>('.card')).find(
      (card) => card.querySelector('h2')?.textContent?.includes('Suggested next courts'),
    );

    expect(previewCard?.textContent).toContain('High Intermediate');
    expect(previewCard?.textContent).toContain('Advanced');
    expect(previewCard?.textContent).toContain('Beginner');
    expect(previewCard?.textContent).toContain('Novice');
  });

  it('should swap only the selected players when moving a player across preview teams', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [
          { id: 1, name: 'Alex', dupr: 4.2, gender: null, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 2, name: 'Jordan', dupr: 3.8, gender: null, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 3, name: 'Casey', dupr: 3.2, gender: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 4, name: 'Morgan', dupr: 2.8, gender: null, skillLevel: 'Novice', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
        ],
        selectedPlayers: [],
        courts: [
          {
            courtNumber: 1,
            players: [],
            teams: [
              {
                name: 'Team 1',
                players: [
                  { id: 1, name: 'Alex', dupr: 4.2, gender: null, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                  { id: 4, name: 'Morgan', dupr: 2.8, gender: null, skillLevel: 'Novice', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                ],
              },
              {
                name: 'Team 2',
                players: [
                  { id: 2, name: 'Jordan', dupr: 3.8, gender: null, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                  { id: 3, name: 'Casey', dupr: 3.2, gender: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                ],
              },
            ],
          },
        ],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const teamButtons = Array.from(compiled.querySelectorAll<HTMLButtonElement>('.court-card .swap-chip'));
    const alexButton = teamButtons.find((button) => button.textContent?.includes('Alex'));
    const jordanButton = teamButtons.find((button) => button.textContent?.includes('Jordan'));

    alexButton!.click();
    jordanButton!.click();
    fixture.detectChanges();

    const teamCards = Array.from(compiled.querySelectorAll<HTMLElement>('.court-card .team-card'));

    expect(teamCards[0].textContent).toContain('Jordan');
    expect(teamCards[0].textContent).toContain('Morgan');
    expect(teamCards[0].textContent).not.toContain('Alex');
    expect(teamCards[1].textContent).toContain('Alex');
    expect(teamCards[1].textContent).toContain('Casey');
    expect(teamCards[1].textContent).not.toContain('JordanHigh IntermediateCasey');
  });

  it('should preserve the roster scroll position after checking in a player', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [
        { id: 1, name: 'Alex', dupr: 3.5, skillLevel: 'High Intermediate', isReady: false, checkedInAt: null, isPlaying: false, recentGamesPlayed: 1 },
        { id: 2, name: 'Jordan', dupr: 4.2, skillLevel: 'Advanced', isReady: false, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 },
      ],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const rosterPanel = compiled.querySelector<HTMLElement>('.player-list.scroll-panel');
    const toggleButton = compiled.querySelector<HTMLButtonElement>('.player-row .toggle');

    rosterPanel!.scrollTop = 180;
    toggleButton!.click();

    const patchRequest = httpTestingController.expectOne('http://localhost:3000/players/1/ready');
    patchRequest.flush({
      id: 1,
      name: 'Alex',
      dupr: 3.5,
      skillLevel: 'High Intermediate',
      isReady: true,
      checkedInAt: '2026-05-24T06:00:00.000Z',
      isPlaying: false,
      recentGamesPlayed: 1,
    });

    const refreshedQueueRequest = expectDefaultQueueRequest();
    refreshedQueueRequest.flush({
      players: [
        { id: 1, name: 'Alex', dupr: 3.5, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
        { id: 2, name: 'Jordan', dupr: 4.2, skillLevel: 'Advanced', isReady: false, checkedInAt: null, isPlaying: false, recentGamesPlayed: 0 },
      ],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [
          { id: 1, name: 'Alex', dupr: 3.5, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
        ],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(rosterPanel?.scrollTop).toBe(180);
  });

  it('should request a sequential matching snapshot when that matching mode is selected', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = compiled.querySelectorAll<HTMLSelectElement>('select');
    const matchingModeSelect = selects[2];

    matchingModeSelect.value = 'sequential';
    matchingModeSelect.dispatchEvent(new Event('change'));

    const modeRequest = httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=queue-line&matchingMode=sequential',
    );

    modeRequest.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'sequential',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(matchingModeSelect.value).toBe('sequential');
    expect(compiled.textContent).toContain('Sequential teams');
  });

  it('should request a skill-balanced snapshot when that matching mode is selected', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = compiled.querySelectorAll<HTMLSelectElement>('select');
    const matchingModeSelect = selects[2];

    matchingModeSelect.value = 'skill-balance';
    matchingModeSelect.dispatchEvent(new Event('change'));

    const modeRequest = httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=queue-line&matchingMode=skill-balance',
    );

    modeRequest.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'skill-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(matchingModeSelect.value).toBe('skill-balance');
    expect(compiled.textContent).toContain('Skill balanced');
  });

  it('should submit the selected preview court number when starting a game', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [
          { id: 1, name: 'Alex', dupr: 3.5, gender: null, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
          { id: 2, name: 'Jordan', dupr: 4.2, gender: null, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 3, name: 'Casey', dupr: null, gender: null, skillLevel: 'Beginner', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
          { id: 4, name: 'Morgan', dupr: 3.1, gender: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 2 },
        ],
        selectedPlayers: [],
        courts: [
          {
            courtNumber: 1,
            players: [
              { id: 1, name: 'Alex', dupr: 3.5, gender: null, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
              { id: 2, name: 'Jordan', dupr: 4.2, gender: null, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
              { id: 3, name: 'Casey', dupr: null, gender: null, skillLevel: 'Beginner', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
              { id: 4, name: 'Morgan', dupr: 3.1, gender: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 2 },
            ],
            teams: [
              {
                name: 'Team 1',
                players: [
                  { id: 1, name: 'Alex', dupr: 3.5, gender: null, skillLevel: 'High Intermediate', isReady: true, checkedInAt: '2026-05-24T06:00:00.000Z', isPlaying: false, recentGamesPlayed: 1 },
                  { id: 4, name: 'Morgan', dupr: 3.1, gender: null, skillLevel: 'Intermediate', isReady: true, checkedInAt: '2026-05-24T06:03:00.000Z', isPlaying: false, recentGamesPlayed: 2 },
                ],
              },
              {
                name: 'Team 2',
                players: [
                  { id: 2, name: 'Jordan', dupr: 4.2, gender: null, skillLevel: 'Advanced', isReady: true, checkedInAt: '2026-05-24T06:01:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                  { id: 3, name: 'Casey', dupr: null, gender: null, skillLevel: 'Beginner', isReady: true, checkedInAt: '2026-05-24T06:02:00.000Z', isPlaying: false, recentGamesPlayed: 0 },
                ],
              },
            ],
          },
        ],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const courtSelect = compiled.querySelector<HTMLSelectElement>('.court-selector select');
    const startButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Start suggested games'),
    );

    courtSelect!.value = '7';
    courtSelect!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    startButton!.click();

    const createRequest = httpTestingController.expectOne('http://localhost:3000/games/batch');
    expect(createRequest.request.body).toEqual({
      gameAssignments: [
        {
          courtNumber: 7,
          playerIds: [1, 2, 3, 4],
        },
      ],
    });

    createRequest.flush([]);
    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
  });

  it('should default multiple suggested preview courts to sequential court numbers', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 3,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [
          { courtNumber: 1, players: [], teams: [] },
          { courtNumber: 1, players: [], teams: [] },
          { courtNumber: 1, players: [], teams: [] },
        ],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const courtSelects = Array.from(compiled.querySelectorAll<HTMLSelectElement>('.court-selector select'));

    expect(courtSelects.map((select) => select.value)).toEqual(['1', '2', '3']);
  });

  it('should keep showing the current matching mode when the snapshot omits matchingMode', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expectDefaultQueueRequest().flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        matchingMode: 'dupr-balance',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = compiled.querySelectorAll<HTMLSelectElement>('select');
    const matchingModeSelect = selects[2];

    matchingModeSelect.value = 'sequential';
    matchingModeSelect.dispatchEvent(new Event('change'));

    const modeRequest = httpTestingController.expectOne(
      'http://localhost:3000/queue?courtCount=1&selectionMode=queue-line&matchingMode=sequential',
    );

    modeRequest.flush({
      players: [],
      ongoingRounds: [],
      recentRounds: [],
      nextGame: {
        courtCount: 1,
        selectionMode: 'queue-line',
        eligiblePlayers: [],
        selectedPlayers: [],
        courts: [],
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(matchingModeSelect.value).toBe('sequential');
    expect(compiled.textContent).toContain('Sequential teams');
  });
});
