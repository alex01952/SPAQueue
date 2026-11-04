import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TournamentPrintingPageComponent } from './tournament-printing-page.component';
import type { TournamentPrintingState } from './tournament.types';

describe('TournamentPrintingPageComponent', () => {
  const state: TournamentPrintingState = {
    tournament: {
      tournamentId: 'event-1', name: 'Club, "Open"', category: 'Mixed Doubles', level: 'Beginner',
      maxSlots: 8, date: '', location: '', registrationCount: 2, pendingRegistrationCount: 0, createdAt: '',
    },
    players: [
      { registrationId: 'team-1', memberId: 'alice', name: 'Alice', tshirtSize: 'XXS', status: 'Approved', version: 'v1', exportedForPrinting: false },
      { registrationId: 'team-1', memberId: 'bob', name: 'Bob', tshirtSize: 'XXXL', status: 'Approved', version: 'v1', exportedForPrinting: true },
      { registrationId: 'team-2', memberId: 'carol', name: '=Formula, "Name"\nLine', status: 'Paid', version: 'v2', exportedForPrinting: false },
    ],
  };
  let fixture: ComponentFixture<TournamentPrintingPageComponent>;
  let http: HttpTestingController;
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:printing');
  const revokeObjectURL = vi.fn();
  let click: ReturnType<typeof vi.spyOn>;

  function getList() {
    return http.expectOne((request) => request.url.endsWith('/event-1/printing-players'));
  }

  function patchTags() {
    return http.expectOne((request) => request.url.endsWith('/event-1/printing-tags'));
  }

  async function readCsv(): Promise<string> {
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  beforeEach(async () => {
    createObjectURL.mockReset().mockReturnValue('blob:printing');
    revokeObjectURL.mockReset();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [TournamentPrintingPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ tournamentId: 'event-1' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TournamentPrintingPageComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const request = getList();
    expect(request.request.withCredentials).toBe(true);
    request.flush(state);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows individual players, sizes, missing sizes and printing status with filters', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Club, "Open"');
    expect(text).toContain('T-shirt size: XXS');
    expect(text).toContain('T-shirt size: XXXL');
    expect(text).toContain('T-shirt size: Not provided');
    expect(text).toContain('1 exported for printing');
    expect(text).toContain('2 not exported');
    fixture.componentInstance['filter'].set('Exported');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.registration-row')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.registration-row').textContent).toContain('Bob');
    fixture.componentInstance['filter'].set('Not exported');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.registration-row')).toHaveLength(2);
  });

  it('downloads one row per fresh untagged player before tagging exactly those players, ignoring the display filter', async () => {
    const component = fixture.componentInstance;
    component['filter'].set('Exported');
    component['exportPlayers']();
    expect(click).not.toHaveBeenCalled();
    const fresh = { ...state, players: [...state.players, {
      registrationId: 'team-3', memberId: 'dave', name: 'Dave', tshirtSize: 'M' as const,
      status: 'Payment Submitted' as const, version: 'v3', exportedForPrinting: false,
    }] };
    getList().flush(fresh);
    const request = patchTags();
    expect(click).toHaveBeenCalledTimes(1);
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      exportedForPrinting: true,
      players: [
        { registrationId: 'team-1', memberId: 'alice', version: 'v1' },
        { registrationId: 'team-2', memberId: 'carol', version: 'v2' },
        { registrationId: 'team-3', memberId: 'dave', version: 'v3' },
      ],
    });
    const csv = await readCsv();
    expect(csv).toContain('"Tournament ID","Tournament name","Registration ID","Player ID","Player name","T-shirt size","Registration status"');
    expect(csv).toContain('"Club, ""Open"""');
    expect(csv).toContain('"alice","Alice","XXS","Approved"');
    expect(csv).toContain(`"carol","'=Formula, ""Name""\nLine","","Paid"`);
    expect(csv).toContain('"dave","Dave","M","Payment Submitted"');
    expect(csv).not.toContain('"bob"');
    expect(csv.split('\r\n')).toHaveLength(5);
    const link = click.mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toMatch(/^tournament-event-1-tshirt-printing-.+\.csv$/);
    expect(link.isConnected).toBe(false);
    request.flush({ updated: true });
    getList().flush({ ...fresh, players: fresh.players.map((player) => ({ ...player, exportedForPrinting: true, version: 'v4' })) });
    expect(component['untaggedPlayers']()).toEqual([]);
    component['exportPlayers']();
    http.expectNone((item) => item.url.endsWith('/printing-players'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(component['feedback']()).toContain('3 players');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:printing');
  });

  it('untags an individual teammate and includes only that player in the next export', () => {
    const component = fixture.componentInstance;
    const allTagged = { ...state, players: state.players.map((player) => ({ ...player, exportedForPrinting: true })) };
    component['state'].set(allTagged);
    component['tagPlayer'](allTagged.players[1]);
    const request = patchTags();
    expect(request.request.body).toEqual({
      exportedForPrinting: false, players: [{ registrationId: 'team-1', memberId: 'bob', version: 'v1' }],
    });
    request.flush({ updated: true });
    const untagged = { ...allTagged, players: allTagged.players.map((player) =>
      player.memberId === 'bob' ? { ...player, exportedForPrinting: false, version: 'v3' } : player,
    ) };
    getList().flush(untagged);
    component['exportPlayers']();
    getList().flush(untagged);
    const tagging = patchTags();
    expect(tagging.request.body.players).toEqual([{ registrationId: 'team-1', memberId: 'bob', version: 'v3' }]);
    tagging.flush({ updated: true });
    getList().flush(allTagged);
    expect(component['untaggedPlayers']()).toEqual([]);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('manually tags a player without triggering a CSV download', () => {
    const component = fixture.componentInstance;
    component['tagPlayer'](state.players[0]);
    const request = patchTags();
    expect(request.request.body).toEqual({
      exportedForPrinting: true, players: [{ registrationId: 'team-1', memberId: 'alice', version: 'v1' }],
    });
    request.flush({ updated: true });
    getList().flush({ ...state, players: state.players.map((player) =>
      player.memberId === 'alice' ? { ...player, exportedForPrinting: true, version: 'v3' } : player,
    ) });
    expect(component['untaggedPlayers']().map((player) => player.memberId)).toEqual(['carol']);
    expect(click).not.toHaveBeenCalled();
  });

  it('tags a large export in bounded sequential batches without splitting teammates or consuming their versions twice', () => {
    const component = fixture.componentInstance;
    const largeState = {
      ...state,
      players: Array.from({ length: 51 }, (_, team) => Array.from({ length: 4 }, (_, player) => ({
        ...state.players[0], registrationId: `team-${team}`, memberId: `player-${team}-${player}`, version: `v${team}`,
      }))).flat(),
    };
    component['exportPlayers']();
    getList().flush(largeState);
    const first = patchTags();
    expect(first.request.body.players).toHaveLength(200);
    expect(first.request.body.players.filter((player: { registrationId: string }) => player.registrationId === 'team-0')).toHaveLength(4);
    http.expectNone((item) => item.url.endsWith('/printing-players'));
    first.flush({ updated: true });
    const second = patchTags();
    expect(second.request.body.players).toHaveLength(4);
    expect(second.request.body.players.every((player: { registrationId: string; version: string }) =>
      player.registrationId === 'team-50' && player.version === 'v50',
    )).toBe(true);
    second.flush({ updated: true });
    getList().flush({ ...largeState, players: largeState.players.map((player) => ({ ...player, exportedForPrinting: true })) });
    expect(component['untaggedPlayers']()).toEqual([]);
    expect(component['feedback']()).toContain('204 players');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('locks export, reload, filters and tag actions during requests and prevents duplicate exports', () => {
    const component = fixture.componentInstance;
    component['exportPlayers']();
    component['exportPlayers']();
    component['tagPlayer'](state.players[0]);
    component['reload']();
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
    getList().flush(state);
    patchTags().flush({ updated: true });
    getList().flush(state);
    expect(component['busy']()).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not download or tag when the fresh server snapshot has no untagged players', () => {
    fixture.componentInstance['exportPlayers']();
    getList().flush({ ...state, players: state.players.map((player) => ({ ...player, exportedForPrinting: true })) });
    expect(click).not.toHaveBeenCalled();
    http.expectNone((item) => item.method === 'PATCH');
    expect(fixture.componentInstance['feedback']()).toContain('No untagged players');
    expect(fixture.componentInstance['busy']()).toBe(false);
  });

  it('does not tag anyone when the CSV download fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    click.mockImplementation(() => { throw new Error('Download failed'); });
    fixture.componentInstance['exportPlayers']();
    getList().flush(state);
    http.expectNone((item) => item.method === 'PATCH');
    expect(fixture.componentInstance['error']()).toContain('No players were tagged');
    expect(fixture.componentInstance['busy']()).toBe(false);
  });

  it('reports a tagging failure after download explicitly and reloads partial results without reporting success', () => {
    const component = fixture.componentInstance;
    component['exportPlayers']();
    getList().flush(state);
    patchTags().flush({ message: 'Printing list changed.' }, { status: 409, statusText: 'Conflict' });
    getList().flush({ ...state, players: state.players.map((player) =>
      player.memberId === 'alice' ? { ...player, exportedForPrinting: true, version: 'v3' } : player,
    ) });
    expect(click).toHaveBeenCalledTimes(1);
    expect(component['error']()).toContain('CSV download started, but printing tags could not be fully saved');
    expect(component['error']()).toContain('Printing list changed.');
    expect(component['feedback']()).toBe('');
    expect(component['untaggedPlayers']().map((player) => player.memberId)).toEqual(['carol']);
    expect(component['busy']()).toBe(false);
  });

  it('does not download or tag stale data after a list fetch fails', () => {
    const component = fixture.componentInstance;
    component['exportPlayers']();
    getList().flush({ message: 'Administrator access is required.' }, { status: 403, statusText: 'Forbidden' });
    expect(click).not.toHaveBeenCalled();
    http.expectNone((item) => item.method === 'PATCH');
    expect(component['state']()).toBeNull();
    expect(component['error']()).toBe('Administrator access is required.');
    component['exportPlayers']();
    http.expectNone((item) => item.method === 'GET');
  });

  it('reports manual tagging conflicts and prevents stale actions when reloading also fails', () => {
    const component = fixture.componentInstance;
    component['tagPlayer'](state.players[0]);
    patchTags().flush({ message: 'Reload before updating printing tags.' }, { status: 409, statusText: 'Conflict' });
    getList().flush({ message: 'Storage unavailable.' }, { status: 502, statusText: 'Bad Gateway' });
    expect(component['state']()).toBeNull();
    expect(component['error']()).toContain('Reload before updating printing tags.');
    expect(component['error']()).toContain('Storage unavailable.');
    expect(component['busy']()).toBe(false);
  });
});
