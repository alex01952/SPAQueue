import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OpenPlayPageComponent } from './open-play-page.component';
import { AuthenticatedMember } from '../member-auth.service';
import { vi } from 'vitest';
import { benchMilliseconds } from './open-play-players';

describe('OpenPlayPageComponent', () => {
  const member = {
    memberId: 'member-1', name: 'Jennifer Smith', reClubId: 'Jenn',
    skills: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`skill${index}`, 10])),
  } as AuthenticatedMember;
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.removeItem('open-play-player-draft-v1');
    await TestBed.configureTestingModule({
      imports: [OpenPlayPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match((request) => request.url.endsWith('/open-play/board-state')).forEach((request) => request.flush({}));
    http.verify();
    localStorage.removeItem('open-play-player-draft-v1');
  });

  function createPage(draft: { players: unknown[]; revision: string | null; playerLocks?: string[][]; forcedCategory?: 'Novice' | 'Intermediate' | 'High Intermediate' | null; secondaryEnabled?: boolean; secondaryForcedCategory?: 'Novice' | 'Intermediate' | 'High Intermediate' | null; nextPlayerIds?: string[] | null; followingPlayerIds?: string[] | null; secondaryNextPlayerIds?: string[] | null } = { players: [], revision: null }) {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'GET').flush({ courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, session: null, benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4, ...draft });
    const directory = http.expectOne((request) => request.url.endsWith('/open-play/members'));
    expect(directory.request.withCredentials).toBe(true);
    directory.flush([member]);
    fixture.detectChanges();
    return fixture;
  }

  it('independently hides setup and history sections while keeping matching visible', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    for (const section of component['sectionOptions']) {
      const toggle = root.querySelector(`#show-open-play-${section.id}`) as HTMLInputElement;
      const target = root.querySelector(`#${toggle.getAttribute('aria-controls')}`) as HTMLElement;
      expect(toggle.checked).toBe(true);
      expect(target.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(toggle.checked).toBe(false);
      expect(target.hidden).toBe(true);
      expect(root.querySelector('.next-players')?.closest('[hidden]')).toBeNull();
      expect(root.querySelector('[aria-labelledby="ongoing-matches-heading"]')?.closest('[hidden]')).toBeNull();
      expect(root.querySelector('.queue-section')?.closest('[hidden]')).toBeNull();
    }
    expect((root.querySelector('.workspace') as HTMLElement).hidden).toBe(true);
    expect(component['isDirty']()).toBe(false);
    const rosterToggle = root.querySelector('#show-open-play-roster') as HTMLInputElement;
    rosterToggle.click();
    fixture.detectChanges();
    expect((root.querySelector('#open-play-roster') as HTMLElement).hidden).toBe(false);
    expect((root.querySelector('#open-play-players') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('.workspace')?.classList.contains('single-column')).toBe(true);
    expect((root.querySelector('.workspace') as HTMLElement).hidden).toBe(false);
  });

  it('preserves entry, import, roster, and match drafts when sections are hidden and shown', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['guestName'].set('Pending guest');
    component['search'].set('Jenn');
    component['selectMember'](member);
    component['newCourtName'].set('Pending court');
    component['importRows'].set([{ name: 'Imported guest', matches: [], selection: 'guest', category: 'Novice', included: true }]);
    component['addMember']();
    const players = component['players']();
    const participants = Array.from({ length: 4 }, (_, index) => ({ id: `participant-${index}`, name: `Player ${index}`, memberId: null }));
    const match = {
      id: 'pending-edit', teams: [participants.slice(0, 2), participants.slice(2, 4)], status: 'completed' as const,
      winner: null, score: null, court: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    component['matches'].set([match]);
    component['editingMatch'].set(match.id);
    component['updateResult'](match, { winner: '1', team1: '11', team2: '5' });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    for (const section of component['sectionOptions']) {
      (root.querySelector(`#show-open-play-${section.id}`) as HTMLInputElement).click();
    }
    fixture.detectChanges();
    expect((root.querySelector('.import-review') as HTMLElement).hidden).toBe(true);
    for (const section of component['sectionOptions']) {
      (root.querySelector(`#show-open-play-${section.id}`) as HTMLInputElement).click();
    }
    fixture.detectChanges();
    expect(component['guestName']()).toBe('Pending guest');
    expect(component['newCourtName']()).toBe('Pending court');
    expect(component['players']()).toEqual(players);
    expect(component['importRows']()[0].included).toBe(true);
    expect((root.querySelector('.import-review') as HTMLElement).hidden).toBe(false);
    expect(component['editingMatch']()).toBe(match.id);
    expect(component['resultDraft'](match)).toMatchObject({ winner: '1', team1: '11', team2: '5' });
    expect(root.querySelector('.result-lineup')).not.toBeNull();
  });

  it('keeps a single compact save control outside the editor with saving, retry, and saved states', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    const bar = root.querySelector('.draft-bar') as HTMLElement;
    const saveButton = bar.querySelector('.save-roster') as HTMLButtonElement;
    expect(root.querySelectorAll('.save-roster')).toHaveLength(1);
    expect(bar.closest('fieldset')).toBeNull();
    expect(saveButton.getAttribute('aria-label')).toBe('Save changes');
    expect(saveButton.disabled).toBe(true);
    component['guestName'].set('New guest');
    component['guestCategory'].set('Novice');
    component['addGuest']();
    fixture.detectChanges();
    expect(saveButton.disabled).toBe(false);
    expect(saveButton.textContent).toBe('Save');
    expect(bar.querySelector('[role="status"]')?.textContent).toContain('Unsaved changes');
    saveButton.click();
    fixture.detectChanges();
    const failed = http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'PUT');
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-busy')).toBe('true');
    expect(bar.querySelector('[role="status"]')?.textContent).toContain('Saving changes');
    failed.flush({}, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();
    expect(saveButton.disabled).toBe(false);
    expect(bar.querySelector('[role="status"]')?.textContent).toContain('Save unavailable');
    expect(component['players']()).toHaveLength(1);
    saveButton.click();
    const request = http.expectOne((entry) => entry.url.endsWith('/open-play/draft') && entry.method === 'PUT');
    request.flush({ ...request.request.body, revision: 'saved-via-sticky-bar', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    fixture.detectChanges();
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-busy')).toBe('false');
    expect(bar.querySelector('[role="status"]')?.textContent).toContain('Changes saved.');
  });

  it('saves member IDs and overrides in the shared draft', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    expect(component['matchingMode']()).toBe('wait-priority');
    expect(fixture.nativeElement.querySelector('#matching-mode option')?.value).toBe('wait-priority');
    expect(component['matchingModeOptions']).toEqual([{ id: 'wait-priority', label: 'Wait-time priority' }]);
    component['selectMember'](member);
    expect(component['memberCategory']()).toBe('High Intermediate');
    component['memberCategory'].set('Novice');
    component['addMember']();
    component['selectMember'](member);
    component['addMember']();
    expect(component['players']()).toHaveLength(1);
    expect(component['message']()).toContain('already');
    expect(component['players']()[0]).toMatchObject({ name: 'Jennifer Smith', memberId: 'member-1', category: 'Novice' });
    component['saveDraft']();
    const request = http.expectOne((item) => item.url.endsWith('/open-play/draft') && item.method === 'PUT');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({ players: component['players'](), courts: [], matches: [], queue: [], winnersQueue: [], bench: component['bench'](), unavailable: [], playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null, secondaryEnabled: false, secondaryForcedCategory: null, nextPlayerIds: ['', '', '', ''], followingPlayerIds: ['', '', '', ''], secondaryNextPlayerIds: null, tieBreakSeed: 0, revision: null });
    const draft = { players: component['players'](), courts: [], matches: [], queue: [], winnersQueue: [], bench: component['bench'](), unavailable: [], playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, revision: 'revision-1', courtNameVersion: 1, queueVersion: 4 };
    request.flush(draft);
    expect(component['isDirty']()).toBe(false);
    fixture.destroy();

    const restored = createPage(draft);
    expect(restored.componentInstance['players']()[0]).toMatchObject({ memberId: 'member-1', category: 'Novice' });
  });

  it('filters registered players by partial names without changing the saved roster or matching queues', async () => {
    const players = [
      { id: 'one', name: 'Alex Park', memberId: 'member-one', category: 'Novice', status: 'Active' },
      { id: 'two', name: 'Alexandra Lee', memberId: null, category: 'Novice', status: 'Rest' },
      { id: 'three', name: 'Sam Rivera', memberId: null, category: 'Intermediate', status: 'Not Arrived' },
    ];
    const fixture = createPage({ players, revision: 'roster-search' });
    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const input = root.querySelector('#roster-search') as HTMLInputElement;
    const queue = [...component['queue']()];
    const winnersQueue = [...component['winnersQueue']()];
    const filter = (query: string) => {
      input.value = query;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    filter('  aLeX  ');
    expect(root.querySelectorAll('.roster-row')).toHaveLength(2);
    expect(root.querySelector('#open-play-roster .roster-heading')?.textContent).toContain('2 of 3 shown');
    filter('pAR');
    expect(root.querySelectorAll('.roster-row')).toHaveLength(1);
    expect(root.querySelector('.roster-row .player-name strong')?.textContent).toContain('Alex Park');
    filter('unknown');
    expect(root.querySelectorAll('.roster-row')).toHaveLength(0);
    expect(root.querySelector('.roster-list [role="status"]')?.textContent).toContain('No players match');
    filter('   ');
    expect(root.querySelectorAll('.roster-row')).toHaveLength(3);
    expect(root.querySelector('#open-play-roster .roster-heading')?.textContent).toContain('3 total');
    filter('');
    expect(root.querySelectorAll('.roster-row')).toHaveLength(3);
    expect(component['players']()).toEqual(players);
    expect(component['queue']()).toEqual(queue);
    expect(component['winnersQueue']()).toEqual(winnersQueue);
    expect(component['search']()).toBe('');
    expect(component['isDirty']()).toBe(false);
  });

  it('updates a filtered player category and status and saves the entire roster', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Target Player']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const others = component['players']().slice(0, 4);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('#roster-search') as HTMLInputElement;
    input.value = 'target   PLAYER';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelectorAll('.roster-row')).toHaveLength(1);
    const category = root.querySelector('[aria-label="Category for Target Player"]') as HTMLSelectElement;
    category.value = 'Intermediate';
    category.dispatchEvent(new Event('change'));
    const status = root.querySelector('[aria-label="Status for Target Player"]') as HTMLSelectElement;
    status.value = 'Rest';
    status.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component['players']()[4]).toMatchObject({ category: 'Intermediate', status: 'Rest' });
    expect(component['players']().slice(0, 4)).toEqual(others);
    expect(component['queue']()).not.toContain(players[4].id);
    expect(root.querySelectorAll('.roster-row')).toHaveLength(1);

    component['saveDraft']();
    const save = http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'PUT');
    expect(save.request.body.players).toHaveLength(5);
    expect(save.request.body.players[4]).toMatchObject({ id: players[4].id, category: 'Intermediate', status: 'Rest' });
    save.flush({ ...save.request.body, revision: 'filtered-edit', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
  });

  it('classifies linked members by active Gold status and identifies guests', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['members'].set([
      { ...member, goldMembershipExpiresOn: '2027-01-01' },
      { ...member, memberId: 'member-2', name: 'Member Two', goldMembershipExpiresOn: null },
    ]);
    component['selectMember'](member);
    component['memberCategory'].set('Novice');
    component['addMember']();
    component['selectMember'](component['members']()[1]);
    component['memberCategory'].set('Novice');
    component['addMember']();
    component['guestName'].set('Guest');
    component['guestCategory'].set('Novice');
    component['addGuest']();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('.roster-row'));
    expect(rows[0].querySelector('.gold-frame')).not.toBeNull();
    expect(rows[1].querySelector('.silver-frame')).not.toBeNull();
    expect(rows[2].querySelector('.membership-name-frame')).toBeNull();
    (rows[0].querySelector('button.text-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('app-member-profile-frame iframe')?.getAttribute('src')).toBe('/member-profile/member-1?embedded=true');
  });

  it('awards selected participation and Top 5 points with distinct idempotency IDs', async () => {
    const fixture = createPage({ players: [], revision: 'saved-revision' });
    const component = fixture.componentInstance;
    const session = {
      id: 'session-one', active: false, startedAt: '2026-11-08T10:00:00Z', endedAt: '2026-11-08T12:00:00Z',
      awardReview: {
        activityDate: '2026-11-08', candidates: [{ memberId: 'gold-1', name: 'Gold Player', participated: true, topFiveRank: 1,
          participationRequestId: '11111111-1111-4111-8111-111111111111', topFiveRequestId: '22222222-2222-4222-8222-222222222222' }],
        selectedAwardIds: ['gold-1:participation', 'gold-1:top-five'], awardedAwardIds: [], skipped: false, completed: false, completedAt: null,
      },
    };
    component['session'].set(session);
    component['selectedAwardIds'].set(session.awardReview.selectedAwardIds);

    const awarding = component['awardSessionPoints']();
    const decision = http.expectOne((request) => request.url.endsWith('/open-play/session/awards'));
    expect(decision.request.body.selectedAwardIds).toEqual(['gold-1:participation', 'gold-1:top-five']);
    decision.flush({ session: { ...session, awardReview: { ...session.awardReview, completed: false } }, revision: 'review-revision' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const participation = http.expectOne((request) => request.url.endsWith('/member-points/gold-1'));
    expect(participation.request.body).toMatchObject({ requestId: session.awardReview.candidates[0].participationRequestId, source: 'CustomAward', activityDate: '2026-11-08', points: 1 });
    participation.flush({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const progressOne = http.expectOne((request) => request.url.endsWith('/open-play/session/awards/progress'));
    expect(progressOne.request.body.awardId).toBe('gold-1:participation');
    progressOne.flush({ session: { ...session, awardReview: { ...session.awardReview, awardedAwardIds: ['gold-1:participation'] } }, revision: 'partial-review' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const topFive = http.expectOne((request) => request.url.endsWith('/member-points/gold-1'));
    expect(topFive.request.body.requestId).toBe(session.awardReview.candidates[0].topFiveRequestId);
    topFive.flush({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const progressTwo = http.expectOne((request) => request.url.endsWith('/open-play/session/awards/progress'));
    expect(progressTwo.request.body.awardId).toBe('gold-1:top-five');
    progressTwo.flush({ session: { ...session, awardReview: { ...session.awardReview, awardedAwardIds: ['gold-1:participation', 'gold-1:top-five'] } }, revision: 'review-complete' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const complete = http.expectOne((request) => request.url.endsWith('/open-play/session/awards/complete'));
    complete.flush({ session: { ...session, awardReview: { ...session.awardReview, completed: true, awardedAwardIds: session.awardReview.selectedAwardIds } }, revision: 'completed-revision' });
    await awarding;
    expect(component['session']()?.awardReview?.completed).toBe(true);
    expect(component['awardMessage']()).toContain('2 Open Play points');
    fixture.destroy();
  });

  it('can close an award review without awarding points', async () => {
    const fixture = createPage({ players: [], revision: 'saved-revision' });
    const component = fixture.componentInstance;
    component['session'].set({ id: 'session-two', active: false, startedAt: '2026-11-08T10:00:00Z', endedAt: '2026-11-08T12:00:00Z',
      awardReview: { activityDate: '2026-11-08', candidates: [], selectedAwardIds: [], awardedAwardIds: [], skipped: false, completed: false, completedAt: null } });
    const skipping = component['skipSessionAwards']();
    const request = http.expectOne((entry) => entry.url.endsWith('/open-play/session/awards'));
    expect(request.request.body.skip).toBe(true);
    request.flush({ session: { id: 'session-two', active: false, startedAt: '2026-11-08T10:00:00Z', endedAt: '2026-11-08T12:00:00Z',
      awardReview: { activityDate: '2026-11-08', candidates: [], selectedAwardIds: [], awardedAwardIds: [], skipped: true, completed: true, completedAt: '2026-11-08T12:01:00Z' } }, revision: 'skipped-revision' });
    await skipping;
    expect(component['session']()?.awardReview?.skipped).toBe(true);
    expect(component['awardMessage']()).toContain('No points were awarded');
    fixture.destroy();
  });

  it('starts and ends Open Play and displays the Gold award review', () => {
    const fixture = createPage({ players: [], revision: 'saved-revision' });
    const component = fixture.componentInstance;
    component['startOpenPlay']();
    const start = http.expectOne((entry) => entry.url.endsWith('/open-play/session/start'));
    expect(start.request.body.revision).toBe('saved-revision');
    start.flush({});
    const activeSession = { id: 'session-one', active: true, startedAt: '2026-11-08T10:00:00Z', endedAt: null, awardReview: null };
    http.expectOne((entry) => entry.url.endsWith('/open-play/draft') && entry.method === 'GET').flush({
      players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, liveBoardState: null, session: activeSession,
      benchMigrationNeeded: false, revision: 'active-revision', courtNameVersion: 1, queueVersion: 4,
    });
    expect(component['session']()?.active).toBe(true);

    component['endOpenPlay']();
    const end = http.expectOne((entry) => entry.url.endsWith('/open-play/session/end'));
    expect(end.request.body.revision).toBe('active-revision');
    end.flush({});
    const reviewSession = {
      id: 'session-one', active: false, startedAt: activeSession.startedAt, endedAt: '2026-11-08T12:00:00Z',
      awardReview: { activityDate: '2026-11-08', candidates: [{ memberId: 'member-1', name: 'Gold Player', participated: true,
        topFiveRank: 1, participationRequestId: '11111111-1111-4111-8111-111111111111', topFiveRequestId: '22222222-2222-4222-8222-222222222222' }],
        selectedAwardIds: ['member-1:participation', 'member-1:top-five'], awardedAwardIds: [], skipped: false, completed: false, completedAt: null },
    };
    http.expectOne((entry) => entry.url.endsWith('/open-play/draft') && entry.method === 'GET').flush({
      players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [],
      matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, liveBoardState: null, session: reviewSession,
      benchMigrationNeeded: false, revision: 'ended-revision', courtNameVersion: 1, queueVersion: 4,
    });
    fixture.detectChanges();
    expect(component['session']()?.active).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Gold member point review');
    expect(fixture.nativeElement.textContent).toContain('Participation · 1 point');
    expect(fixture.nativeElement.textContent).toContain('Top 5 bonus · 1 point');
    fixture.destroy();
  });

  it('archives a completed session and reloads the cleared roster', () => {
    const fixture = createPage({ players: [], revision: 'ended-revision' });
    const component = fixture.componentInstance;
    const session = { id: 'session-archive', active: false, startedAt: '2026-11-08T10:00:00Z', endedAt: '2026-11-08T12:00:00Z',
      awardReview: { activityDate: '2026-11-08', candidates: [], selectedAwardIds: [], awardedAwardIds: [], skipped: true, completed: true, completedAt: '2026-11-08T12:01:00Z' } };
    component['session'].set(session);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.detectChanges();
    expect(component['canArchiveOpenPlay']()).toBe(true);

    component['archiveOpenPlay']();
    const archive = http.expectOne((entry) => entry.url.endsWith('/open-play/session/archive'));
    expect(archive.request.body).toEqual({ sessionId: session.id, revision: 'ended-revision' });
    archive.flush({ players: [], courts: [], matches: [], revision: 'cleared-revision' });
    const reload = http.expectOne((entry) => entry.url.endsWith('/open-play/draft') && entry.method === 'GET');
    reload.flush({ players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [], matchingMode: 'wait-priority', forcedCategory: null, nextPlayerIds: null, session: null, benchMigrationNeeded: false, revision: null, courtNameVersion: 1, queueVersion: 4 });
    fixture.detectChanges();
    expect(component['session']()).toBeNull();
    expect(component['archiveMessage']()).toContain('roster has been cleared');
    confirm.mockRestore();
    fixture.destroy();
  });

  it('automatically selects matched members and imports only included players with editable categories', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['importCategory'].set('Intermediate');
    const input = { files: [{ name: 'players.txt', text: async () => 'Coaches (1)\n1. Coach\nParticipants (3)\n1. Jenn\n2. Guest\n3. Excluded\nRequested (1)\n1. Waiting' }], value: 'players.txt' };
    await component['readFile']({ target: input } as unknown as Event);
    expect(component['importRows']()).toHaveLength(3);
    expect(component['pendingImport']()).toBe(false);
    expect(component['importRows']()[0].selection).toBe('member-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const profileButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.matches button'))
      .find((button) => button.textContent?.includes('Jennifer Smith'));
    expect(profileButton).toBeTruthy();
    profileButton!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-member-profile-frame iframe')?.getAttribute('src')).toBe('/member-profile/member-1?embedded=true');
    (fixture.nativeElement.querySelector('[aria-label="Close member profile"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-member-profile-frame')).toBeNull();
    expect((fixture.nativeElement.querySelector('select[aria-label="Identity for Jenn"]') as HTMLSelectElement).value).toBe('member-1');
    component['updateImport'](0, { category: 'High Intermediate' });
    component['updateImport'](2, { included: false });
    component['addImport']();
    expect(component['players']()).toEqual([
      expect.objectContaining({ name: 'Jennifer Smith', memberId: 'member-1', category: 'High Intermediate', status: 'Not Arrived' }),
      expect.objectContaining({ name: 'Guest', memberId: null, category: 'Intermediate', status: 'Not Arrived' }),
    ]);
    component['updateCategory'](component['players']()[1].id, 'Novice');
    expect(component['players']()[1].category).toBe('Novice');
  });

  it('defaults to the first match while allowing another matching member to be selected', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['members'].set([member, { ...member, memberId: 'member-2', name: 'Another Jennifer' }]);
    component['importCategory'].set('Intermediate');
    await component['readFile']({ target: { files: [{ name: 'players.txt', text: async () => 'Participants (1)\n1. Jenn' }], value: '' } } as unknown as Event);
    expect(component['importRows']()[0].selection).toBe('member-1');
    component['updateImport'](0, { selection: 'member-2' });
    component['addImport']();
    expect(component['players']()).toEqual([
      expect.objectContaining({ name: 'Another Jennifer', memberId: 'member-2', category: 'Intermediate' }),
    ]);
  });

  it('can treat a matched name as a non-member and add a manual player', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['importCategory'].set('Novice');
    await component['readFile']({ target: { files: [{ name: 'players.txt', text: async () => 'Participants (1)\n1. Jenn' }], value: '' } } as unknown as Event);
    component['updateImport'](0, { selection: 'guest' });
    component['addImport']();
    component['guestName'].set('Visitor');
    component['guestCategory'].set('High Intermediate');
    component['addGuest']();
    expect(component['players']()).toEqual([
      expect.objectContaining({ name: 'Jenn', memberId: null, category: 'Novice' }),
      expect.objectContaining({ name: 'Visitor', memberId: null, category: 'High Intermediate' }),
    ]);
  });

  it('blocks imports when the member directory cannot load', () => {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({ players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], revision: null, courtNameVersion: 1, queueVersion: 4 });
    http.expectOne((request) => request.url.endsWith('/open-play/members')).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.componentInstance['memberError']()).toContain('Retry');
    expect((fixture.nativeElement.querySelector('#import-file') as HTMLInputElement).disabled).toBe(true);
  });

  it('stops loading and offers retry when the directory request stalls', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(OpenPlayPageComponent);
      fixture.detectChanges();
      http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({ players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], revision: null, courtNameVersion: 1, queueVersion: 4 });
      const directory = http.expectOne((request) => request.url.endsWith('/open-play/members'));
      vi.advanceTimersByTime(20000);
      expect(directory.cancelled).toBe(true);
      expect(fixture.componentInstance['loadingMembers']()).toBe(false);
      expect(fixture.componentInstance['memberError']()).toContain('Retry');
      fixture.componentInstance['loadMembers']();
      http.expectOne((request) => request.url.endsWith('/open-play/members')).flush([member]);
      expect(fixture.componentInstance['members']()).toEqual([member]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers retry for an invalid directory response', () => {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({ players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], revision: null, courtNameVersion: 1, queueVersion: 4 });
    http.expectOne((request) => request.url.endsWith('/open-play/members')).flush({});
    expect(fixture.componentInstance['loadingMembers']()).toBe(false);
    expect(fixture.componentInstance['memberError']()).toContain('Retry');
  });

  it('retains unsaved changes when another admin saves first', () => {
    const fixture = createPage({ players: [], revision: 'old-revision' });
    const component = fixture.componentInstance;
    component['guestName'].set('Visitor');
    component['guestCategory'].set('Novice');
    component['addGuest']();
    component['saveDraft']();
    http.expectOne((request) => request.method === 'PUT').flush({}, { status: 409, statusText: 'Conflict' });
    expect(component['players']()).toHaveLength(1);
    expect(component['isDirty']()).toBe(true);
    expect(component['storageError']()).toContain('Another admin');
  });

  it('shows validation errors and retains unsaved players', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['guestName'].set('Visitor');
    component['guestCategory'].set('Novice');
    component['addGuest']();
    component['saveDraft']();
    http.expectOne((request) => request.method === 'PUT').flush(
      { message: 'The player list is too large.' }, { status: 400, statusText: 'Bad Request' },
    );
    expect(component['storageError']()).toContain('The player list is too large.');
    expect(component['isDirty']()).toBe(true);
  });

  it('keeps unsaved state if an older API omits match history from a save response', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['guestName'].set('Visitor');
    component['guestCategory'].set('Novice');
    component['addGuest']();
    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    request.flush({ players: request.request.body.players, revision: 'old-api' });
    expect(component['isDirty']()).toBe(true);
    expect(component['storageError']()).toContain('restart the API');
    expect(component['players']()).toHaveLength(1);
  });

  it('blocks editing when an older API cannot preserve virtual courts', () => {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({ players: [], matches: [], revision: null });
    http.expectOne((request) => request.url.endsWith('/open-play/members')).flush([]);
    fixture.detectChanges();
    expect(fixture.componentInstance['draftReady']()).toBe(false);
    expect(fixture.componentInstance['storageError']()).toContain('restart the API');
    expect((fixture.nativeElement.querySelector('fieldset.editor') as HTMLFieldSetElement).disabled).toBe(true);
  });

  it('blocks editing when the API supports courts but not court names', () => {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({ players: [], courts: [], matches: [], revision: null });
    http.expectOne((request) => request.url.endsWith('/open-play/members')).flush([]);
    expect(fixture.componentInstance['draftReady']()).toBe(false);
    expect(fixture.componentInstance['storageError']()).toContain('court names');
  });

  it('adds a named court using the form and displays its name', async () => {
    const fixture = createPage();
    const input = fixture.nativeElement.querySelector('#new-court-name') as HTMLInputElement;
    input.value = 'Arena South';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.court-add button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.court-title strong').textContent).toBe('Arena South');
    expect(fixture.componentInstance['courts']()[0]).toMatchObject({ name: 'Arena South' });
    expect(fixture.componentInstance['newCourtName']()).toBe('');
  });

  it('offers the old browser draft only when the shared roster is empty', () => {
    const legacy = [{ id: 'legacy-1', name: 'Visitor', category: 'Novice', memberId: null }];
    localStorage.setItem('open-play-player-draft-v1', JSON.stringify(legacy));
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['restoreLegacyDraft']();
    expect(component['players']()).toEqual([{ ...legacy[0], status: 'Active' }]);
    expect(component['isDirty']()).toBe(true);
    expect(localStorage.getItem('open-play-player-draft-v1')).not.toBeNull();
  });

  it('locks selected players together and prunes a lock when fewer than two remain', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    component['toggleLockPlayer'](players[0].id, true);
    component['toggleLockPlayer'](players[1].id, true);
    component['lockSelectedPlayers']();
    expect(component['playerLocks']()).toEqual([[players[0].id, players[1].id]]);
    component['toggleLockPlayer'](players[0].id, true);
    expect(component['selectedLockPlayerIds']()).toEqual([]);
    component['removePlayer'](players[0].id);
    expect(component['playerLocks']()).toEqual([]);
  });

  it('saves and reloads player lock groups with the shared roster', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['toggleLockPlayer'](player.id, true));
    component['lockSelectedPlayers']();
    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    expect(request.request.body.playerLocks).toEqual([[players[0].id, players[1].id]]);
    const savedDraft = { ...request.request.body, revision: 'saved-locks', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 };
    request.flush(savedDraft);
    expect(component['isDirty']()).toBe(false);
    fixture.destroy();

    const restored = createPage({ players: savedDraft.players, playerLocks: savedDraft.playerLocks, revision: 'saved-locks' });
    expect(restored.componentInstance['playerLocks']()).toEqual([[players[0].id, players[1].id]]);
  });

  it('saves and reloads the admin-selected Next Players slots', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['manualMatchSlots'].set(players.map((player) => player.id));
    component['saveDraft']();
    const request = http.expectOne((entry) => entry.method === 'PUT');
    expect(request.request.body.nextPlayerIds).toEqual(players.map((player) => player.id));
    const savedDraft = { ...request.request.body, revision: 'saved-next-players', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 };
    request.flush(savedDraft);
    expect(component['isDirty']()).toBe(false);
    fixture.destroy();

    const restored = createPage({ players: savedDraft.players, nextPlayerIds: savedDraft.nextPlayerIds, revision: 'saved-next-players' });
    expect(restored.componentInstance['manualMatchSlots']()).toEqual(players.map((player) => player.id));
  });

  it('publishes a fresh shared tie-break seed when refreshing suggestions', () => {
    const fixture = createPage();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      fixture.componentInstance['resetNextPlayers']();
      const publish = http.expectOne((request) => request.url.endsWith('/open-play/board-state'));
      expect(publish.request.body.tieBreakSeed).toBe(0x40000000);
      expect(fixture.componentInstance['tieBreakSeed']()).toBe(0x40000000);
      publish.flush({});
    } finally {
      random.mockRestore();
    }
  });

  it('shows the refresh suggestions button even without a manual lineup', () => {
    const fixture = createPage();
    expect(fixture.componentInstance['manualMatchSlots']()).toBeNull();
    const refresh = fixture.nativeElement.querySelector('.refresh-suggestions') as HTMLButtonElement;
    expect(refresh).not.toBeNull();
    expect(refresh.textContent).toContain('Refresh suggestions');
  });

  it('promotes the waiting group unchanged and generates four new players behind it', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (let index = 0; index < 12; index++) {
      component['guestName'].set(`Queued player ${index}`);
      component['guestCategory'].set('Intermediate');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const first = players.slice(0, 4).map((player) => player.id);
    const following = players.slice(4, 8).map((player) => player.id);
    component['manualMatchSlots'].set(first);
    component['manualFollowingMatchSlots'].set(following);
    component['addCourt']();
    component['startMatch']();
    expect(component['ongoingMatches']()[0].teams.flat().map((player) => player.id)).toEqual(first);
    expect(component['matchSlots']()).toEqual(following);
    expect(component['followingMatchSlots']()).toEqual(expect.arrayContaining(players.slice(8).map((player) => player.id)));
    const newGroup = [...component['followingMatchSlots']()];
    component['now'].update((now) => now + 3600000);
    component['queue'].update((queue) => queue.slice().reverse());
    expect(component['matchSlots']()).toEqual(following);
    expect(component['followingMatchSlots']()).toEqual(newGroup);
    expect(new Set([...first, ...following, ...newGroup]).size).toBe(12);
  });

  it.each([4, 8, 12])('saves and restores the advanced queue after starting with %s available players', (count) => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (let index = 0; index < count; index++) {
      component['guestName'].set(`Ready player ${index}`);
      component['guestCategory'].set('Intermediate');
      component['addGuest']();
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    const first = [...component['matchSlots']()];
    const following = [...component['followingMatchSlots']()];
    component['startMatchAndSave']();
    const request = http.expectOne((entry) => entry.url.endsWith('/open-play/draft') && entry.method === 'PUT');
    const body = request.request.body;
    expect(body.matches[0].teams.flat().map((player: { id: string }) => player.id)).toEqual(first);
    expect(body.nextPlayerIds).toEqual(following);
    expect(body.followingPlayerIds.filter(Boolean)).toHaveLength(count === 12 ? 4 : 0);
    const waiting = [...body.nextPlayerIds, ...body.followingPlayerIds].filter(Boolean);
    expect(new Set(waiting).size).toBe(waiting.length);
    expect(waiting.some((id) => first.includes(id))).toBe(false);
    const saved = { ...body, revision: 'advanced-queue', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 };
    request.flush(saved);
    expect(component['isDirty']()).toBe(false);
    fixture.destroy();
    const restored = createPage(saved).componentInstance;
    expect(restored['matchSlots']()).toEqual(body.nextPlayerIds);
    expect(restored['followingMatchSlots']()).toEqual(body.followingPlayerIds);
    restored['now'].update((now) => now + 3600000);
    expect(restored['matchSlots']()).toEqual(body.nextPlayerIds);
    expect(restored['followingMatchSlots']()).toEqual(body.followingPlayerIds);
  });

  it('swaps players between waiting groups without duplicating them or reshuffling teammates', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (let index = 0; index < 9; index++) {
      component['guestName'].set(`Swap player ${index}`);
      component['guestCategory'].set('Intermediate');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const first = players.slice(0, 4).map((player) => player.id);
    const following = players.slice(4, 8).map((player) => player.id);
    component['manualMatchSlots'].set(first);
    component['manualFollowingMatchSlots'].set(following);
    component['updateMatchSlot'](1, following[2]);
    expect(component['matchSlots']()).toEqual([first[0], following[2], first[2], first[3]]);
    expect(component['followingMatchSlots']()).toEqual([following[0], following[1], first[1], following[3]]);
    const reserved = [...component['followingMatchSlots']()];
    component['markUnavailable'](0);
    expect(component['matchSlots']()[0]).toBe(players[8].id);
    expect(component['followingMatchSlots']()).toEqual(reserved);
    expect(new Set([...component['matchSlots'](), ...reserved]).size).toBe(8);
  });

  it('forces and persists the selected matching category', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const [prefix, category] of [['Novice', 'Novice'], ['High', 'High Intermediate']] as const) {
      for (let index = 0; index < 4; index++) {
        component['guestName'].set(`${prefix} ${index}`);
        component['guestCategory'].set(category);
        component['addGuest']();
      }
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['changeForcedCategory']('High Intermediate');
    fixture.detectChanges();
    expect(component['nextSuggestion']()?.teams.flat().every((player) => player.category === 'High Intermediate')).toBe(true);
    expect(component['forcedCategory']()).toBe('High Intermediate');
    expect(fixture.nativeElement.querySelector('#matching-category option[value="High Intermediate"]')).not.toBeNull();
    const publish = http.expectOne((request) => request.url.endsWith('/open-play/board-state') && request.method === 'PUT');
    expect(publish.request.body.forcedCategory).toBe('High Intermediate');
    publish.flush({ forcedCategory: 'High Intermediate' });

    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    expect(request.request.body.forcedCategory).toBe('High Intermediate');
    const savedDraft = { ...request.request.body, revision: 'forced-category', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 };
    request.flush(savedDraft);
    expect(component['isDirty']()).toBe(false);
    fixture.destroy();

    const restored = createPage({ players: savedDraft.players, forcedCategory: 'High Intermediate', revision: 'forced-category' });
    expect(restored.componentInstance['forcedCategory']()).toBe('High Intermediate');
  });

  it('prevents starting a manually selected match with only part of a locked group', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['playerLocks'].set([[players[0].id, players[1].id]]);
    component['addCourt']();
    component['manualMatchSlots'].set([players[0].id, players[2].id, players[3].id, players[4].id]);

    expect(component['validMatchSlots']()).toBe(false);
    component['startMatch']();
    expect(component['ongoingMatches']()).toHaveLength(0);
    expect(component['matchError']()).toContain('Locked players must be selected together');
  });

  it('clears only the locked group when a locked player is marked unavailable', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['playerLocks'].set([[players[0].id, players[1].id]]);
    component['manualMatchSlots'].set(players.slice(0, 4).map((player) => player.id));

    component['markUnavailable'](0);

    expect(component['manualMatchSlots']()).toEqual(['', '', players[2].id, players[3].id]);
    expect(component['validMatchSlots']()).toBe(false);
  });

  it.each(['publish', 'save'] as const)('pins automatic suggestions on %s until the admin refreshes or swaps them', (action) => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (let index = 0; index < 8; index++) {
      component['guestName'].set(`Stable player ${index}`);
      component['guestCategory'].set('Intermediate');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const lineup = [...component['matchSlots']()];
    if (action === 'publish') component['publishNextPlayersState']();
    else component['saveDraft']();
    const request = http.expectOne((entry) => entry.url.endsWith(action === 'publish' ? '/open-play/board-state' : '/open-play/draft') && entry.method === 'PUT');
    expect(request.request.body).toMatchObject({ nextPlayerIds: lineup, secondaryEnabled: false, secondaryNextPlayerIds: null });
    if (action === 'publish') request.flush(request.request.body);
    else request.flush({ ...request.request.body, revision: 'pinned-lineup', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    component['queue'].set(players.slice().reverse().map((player) => player.id));
    component['now'].update((now) => now + 60 * 60000);
    component['tieBreakSeed'].set(999);
    component['forcedCategory'].set('Novice');
    expect(component['matchSlots']()).toEqual(lineup);
    expect(component['nextPlayerIdsForSave']()).toEqual(lineup);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#secondary-suggestions-enabled')).toBeNull();
    expect(fixture.nativeElement.querySelector('.secondary-next')).toBeNull();
    component['updateMatchSlot'](0, players[7].id);
    expect(component['matchSlots']()).toEqual([players[7].id, ...lineup.slice(1)]);
    component['forcedCategory'].set('Intermediate');
    component['resetNextPlayers']();
    const refreshed = [...component['matchSlots']()];
    expect(refreshed).not.toEqual(lineup);
    const publish = http.expectOne((entry) => entry.url.endsWith('/open-play/board-state'));
    expect(publish.request.body.nextPlayerIds).toEqual(refreshed);
    publish.flush({});
    component['now'].update((now) => now + 60000);
    expect(component['matchSlots']()).toEqual(refreshed);
  });

  it('tracks statuses, completes a match without scores, and preserves results after removal and rejoining', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['selectMember'](member);
    component['addMember']();
    for (const name of ['Guest One', 'Guest Two', 'Guest Three']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['updateStatus'](players[1].id, 'Rest');
    expect(component['eligiblePlayers']()).toHaveLength(3);
    component['updateStatus'](players[1].id, 'Active');
    component['addCourt']();
    players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    expect(component['ongoingMatches']()).toHaveLength(1);
    expect(component['ongoingMatches']()[0].court).toEqual({ number: 1, name: 'Court 1', category: 'Novice' });
    component['removeCourt'](1);
    component['updateCourt'](1, 'Intermediate');
    expect(component['courts']()).toEqual([{ number: 1, name: 'Court 1', category: 'Novice' }]);
    expect(component['availableCourts']()).toHaveLength(0);
    expect(component['eligiblePlayers']()).toHaveLength(0);
    const match = component['ongoingMatches']()[0];
    component['removePlayer'](players[0].id);
    component['updateResult'](match, { winner: '1' });
    component['saveResult'](match);
    const endedAt = component['completedMatches']()[0].completedAt;
    expect(component['lastGameEndedAt'](players[1])).toBe(endedAt);
    expect(component['availableCourts']()).toHaveLength(1);
    expect(component['completedMatches']()[0]).toMatchObject({ winner: 1, score: null });
    expect(component['playerRecord'](players[1])).toEqual({ wins: 1, losses: 0 });
    expect(component['playerRecord'](players[2])).toEqual({ wins: 0, losses: 1 });
    component['selectMember'](member);
    component['addMember']();
    const rejoined = component['players']().find((player) => player.memberId === member.memberId)!;
    expect(component['playerRecord'](rejoined)).toEqual({ wins: 1, losses: 0 });
    expect(component['lastGameEndedAt'](rejoined)).toBe(endedAt);
    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    expect(request.request.body.matches[0].teams[0][0]).toMatchObject({ memberId: 'member-1', name: member.name });
    request.flush({ ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
    const saved = { ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 };
    fixture.destroy();
    const restored = createPage(saved);
    const restoredMember = restored.componentInstance['players']().find((player) => player.memberId === member.memberId)!;
    expect(restored.componentInstance['lastGameEndedAt'](restoredMember)).toBe(endedAt);
  });

  it('uses the latest completed game and updates elapsed time as the clock advances', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      component['selectMember'](member);
      component['addMember']();
      component['updateStatus'](component['players']()[0].id, 'Active');
      component['guestName'].set('New Guest');
      component['guestCategory'].set('Novice');
      component['addGuest']();
      const participant = { id: 'previous-roster-id', name: member.name, memberId: member.memberId };
      const teams = [[participant, { id: 'guest-1', name: 'Guest 1', memberId: null }],
        [{ id: 'guest-2', name: 'Guest 2', memberId: null }, { id: 'guest-3', name: 'Guest 3', memberId: null }]];
      component['matches'].set([
        { id: 'latest', teams, status: 'completed', winner: 1, score: null, startedAt: '2026-11-08T11:00:00Z', completedAt: '2026-11-08T19:30:00+08:00', court: null },
        { id: 'older', teams, status: 'completed', winner: 2, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:30:00Z', court: null },
        { id: 'ongoing', teams: teams.map((team) => team.map((entry) => ({ ...entry, id: `other-${entry.id}`, memberId: null }))), status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T11:50:00Z', completedAt: null, court: null },
      ]);
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll('.roster-row') as NodeListOf<HTMLElement>;
      expect(rows[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-11-08T19:30:00+08:00');
      expect(rows[0].textContent).toContain('30m ago');
      expect(rows[1].textContent).toContain('No completed games');
      const dirtyBeforeTick = component['isDirty']();
      vi.advanceTimersByTime(60000);
      fixture.detectChanges();
      expect(rows[0].textContent).toContain('31m ago');
      expect(component['isDirty']()).toBe(dirtyBeforeTick);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid scores and updates player records when a result is corrected', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    const match = component['ongoingMatches']()[0];
    component['updateResult'](match, { winner: '1', team1: '3', team2: '11' });
    component['saveResult'](match);
    expect(component['resultError']()).toContain('winning team');
    expect(component['ongoingMatches']()).toHaveLength(1);
    component['updateResult'](match, { team1: '11', team2: '3' });
    component['saveResult'](match);
    expect(component['completedMatches']()[0].score).toEqual({ team1: 11, team2: 3 });
    const completed = component['completedMatches']()[0];
    component['updateResult'](completed, { winner: '2', team1: '', team2: '' });
    component['saveResult'](completed);
    expect(component['playerRecord'](players[0])).toEqual({ wins: 0, losses: 1 });
    expect(component['playerRecord'](players[2])).toEqual({ wins: 1, losses: 0 });
  });

  it('corrects completed team lineups and player records without changing clocks or locks', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Replacement']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    component['manualMatchSlots'].set(players.slice(0, 4).map((player) => player.id));
    component['startMatch']();
    const ongoing = component['ongoingMatches']()[0];
    component['updateResult'](ongoing, { winner: '1', team1: '11', team2: '5' });
    component['saveResult'](ongoing);
    const completed = component['completedMatches']()[0];
    const bench = structuredClone(component['bench']());
    const locks = [[players[0].id, players[1].id]];
    component['playerLocks'].set(locks);

    component['updateResultPlayer'](completed, 0, players[2].id);
    expect(component['matches']()[0]).toEqual(completed);
    expect(component['resultDraft'](completed).teams.flat().map((player) => player.id))
      .toEqual([players[2].id, players[1].id, players[0].id, players[3].id]);
    component['updateResultPlayer'](completed, 3, players[4].id);
    component['saveResult'](completed);

    const corrected = component['completedMatches']()[0];
    expect(corrected.teams.flat().map((player) => player.id)).toEqual([players[2].id, players[1].id, players[0].id, players[4].id]);
    expect(corrected).toMatchObject({ startedAt: completed.startedAt, completedAt: completed.completedAt, winner: 1, score: { team1: 11, team2: 5 } });
    expect(players.map((player) => component['playerRecord'](player))).toEqual([
      { wins: 0, losses: 1 }, { wins: 1, losses: 0 }, { wins: 1, losses: 0 }, { wins: 0, losses: 0 }, { wins: 0, losses: 1 },
    ]);
    expect(component['winnersQueue']()).toEqual([players[2].id, players[1].id]);
    expect(new Set(component['queue']())).toEqual(new Set([players[0].id, players[3].id, players[4].id]));
    expect(component['bench']()).toEqual(bench);
    expect(component['playerLocks']()).toEqual(locks);
    expect(component['isDirty']()).toBe(true);
  });

  it('edits completed lineups through the controls and discards canceled edits', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Replacement']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    const completed = {
      id: 'editable', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'completed' as const,
      winner: 1 as const, score: { team1: 11, team2: 5 }, court: null,
      startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    component['matches'].set([completed]);
    component['removePlayer'](players[0].id);
    fixture.detectChanges();
    const history = fixture.nativeElement.querySelector('[aria-labelledby="matches-heading"]') as HTMLElement;
    (history.querySelector('.secondary') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    let selectors = history.querySelectorAll('.result-lineup select') as NodeListOf<HTMLSelectElement>;
    expect(selectors).toHaveLength(4);
    expect(selectors[0].value).toBe(players[0].id);
    selectors[0].value = players[2].id;
    selectors[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['matches']()[0]).toEqual(completed);
    expect(selectors[2].value).toBe(players[0].id);
    (Array.from(history.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cancel edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component['matches']()[0]).toEqual(completed);
    expect(component['resultDrafts']()).toEqual({});

    (history.querySelector('.secondary') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    selectors = history.querySelectorAll('.result-lineup select');
    expect(selectors[0].value).toBe(players[0].id);
    selectors[0].value = players[4].id;
    selectors[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (history.querySelector('.primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(history.querySelector('.teams')?.textContent).toContain('Replacement / Two');
    expect(history.querySelector('.result-lineup')).toBeNull();
    expect(component['players']().map((player) => player.status)).toEqual(Array(4).fill('Not Arrived'));

    component['saveDraft']();
    const save = http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'PUT');
    expect(save.request.body.matches[0].teams.flat().map((player: { id: string }) => player.id))
      .toEqual([players[4].id, players[1].id, players[2].id, players[3].id]);
    save.flush({ ...save.request.body, revision: 'edited-lineup', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
  });

  it('keeps later results authoritative and restores earlier results for removed participants', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const completed = {
      id: 'corrected', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'completed' as const,
      winner: 1 as const, score: null, court: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    const earlier = { ...completed, id: 'earlier', teams: [[players[0], players[4]], [players[1], players[5]]], completedAt: '2026-11-08T09:15:00Z' };
    const later = { ...completed, id: 'later', teams: [[players[1], players[2]], [players[4], players[5]]], winner: 2 as const, completedAt: '2026-11-08T11:15:00Z' };
    component['matches'].set([earlier, completed, later]);
    component['queue'].set([players[1].id, players[2].id, players[3].id]);
    component['winnersQueue'].set([players[0].id, players[4].id, players[5].id]);
    const bench = structuredClone(component['bench']());

    component['updateResultPlayer'](completed, 0, players[4].id);
    component['updateResultPlayer'](completed, 1, players[3].id);
    component['saveResult'](completed);

    expect(component['queue']()).toEqual([players[1].id, players[2].id]);
    expect(component['winnersQueue']()).toEqual([players[4].id, players[5].id, players[3].id, players[0].id]);
    expect(component['lastGameEndedAt'](players[0])).toBe(earlier.completedAt);
    expect(component['bench']()).toEqual(bench);
    expect(component['matches']().find((match) => match.id === later.id)).toEqual(later);
  });

  it('requires a warning and explicit confirmation before deleting a completed match and saves its removal', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    const participants = Array.from({ length: 4 }, (_, index) => ({ id: `deleted-${index}`, name: `Player ${index}`, memberId: null }));
    const completed = {
      id: 'delete-me', teams: [participants.slice(0, 2), participants.slice(2, 4)], status: 'completed' as const,
      winner: 1 as const, score: { team1: 11, team2: 5 }, court: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    component['matches'].set([completed]);
    component['saveDraft']();
    const initialSave = http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'PUT');
    initialSave.flush({ ...initialSave.request.body, revision: 'saved-game', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
    component['deleteCompletedMatch'](completed.id);
    expect(component['matches']()).toEqual([completed]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const history = root.querySelector('[aria-labelledby="matches-heading"]') as HTMLElement;
    (history.querySelector('.delete-match') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(history.querySelector('.delete-confirmation [id]')?.textContent).toContain('cannot be undone after saving');
    expect(component['matches']()).toEqual([completed]);
    const cancel = Array.from(history.querySelectorAll('.delete-confirmation button')).find((button) => button.textContent === 'Cancel') as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();
    expect(history.querySelector('.delete-confirmation')).toBeNull();
    expect(component['matches']()).toEqual([completed]);

    component['editingMatch'].set(completed.id);
    component['updateResult'](completed, { winner: '2' });
    (history.querySelector('.delete-match') as HTMLButtonElement).click();
    fixture.detectChanges();
    (history.querySelector('.delete-confirmation .delete-match') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component['matches']()).toEqual([]);
    expect(component['resultDrafts']()).toEqual({});
    expect(component['editingMatch']()).toBe('');
    expect(component['pendingDeleteMatchId']()).toBe('');
    expect(component['isDirty']()).toBe(true);
    expect(history.textContent).toContain('No completed matches');
    component['saveDraft']();
    const save = http.expectOne((request) => request.url.endsWith('/open-play/draft') && request.method === 'PUT');
    expect(save.request.body.matches).toEqual([]);
    save.flush({ ...save.request.body, revision: 'deleted-game', benchMigrationNeeded: false, courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
  });

  it('restores prior results after deletion without changing later games, player status, clocks, or locks', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['updateStatus'](players[3].id, 'Rest');
    const deleted = {
      id: 'delete-result', teams: [players.slice(0, 2), players.slice(2, 4)], status: 'completed' as const,
      winner: 1 as const, score: null, court: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    const earlier = { ...deleted, id: 'earlier-result', teams: [[players[0], players[4]], [players[1], players[5]]], winner: 2 as const, completedAt: '2026-11-08T09:15:00Z' };
    const later = { ...deleted, id: 'later-result', teams: [[players[1], players[2]], [players[4], players[5]]], completedAt: '2026-11-08T11:15:00Z' };
    const ongoing = { ...deleted, id: 'ongoing-game', status: 'ongoing' as const, winner: null, completedAt: null };
    component['matches'].set([earlier, deleted, later, ongoing]);
    component['queue'].set([players[2].id, players[4].id, players[5].id]);
    component['winnersQueue'].set([players[0].id, players[1].id]);
    component['playerLocks'].set([[players[0].id, players[1].id]]);
    const bench = structuredClone(component['bench']());
    const roster = structuredClone(component['players']());
    component['pendingDeleteMatchId'].set(deleted.id);
    component['deleteCompletedMatch'](deleted.id);
    expect(component['matches']()).toEqual([earlier, later, ongoing]);
    expect(component['lastGameEndedAt'](players[0])).toBe(earlier.completedAt);
    expect(component['playerRecord'](players[0])).toEqual({ wins: 0, losses: 1 });
    expect(component['queue']()).toEqual([players[2].id, players[4].id, players[5].id, players[0].id]);
    expect(component['winnersQueue']()).toEqual([players[1].id]);
    expect(component['players']()).toEqual(roster);
    expect(component['bench']()).toEqual(bench);
    expect(component['playerLocks']()).toEqual([[players[0].id, players[1].id]]);
    component['pendingDeleteMatchId'].set(ongoing.id);
    component['deleteCompletedMatch'](ongoing.id);
    expect(component['matches']()).toContain(ongoing);
  });

  it('rejects duplicate players in a completed lineup without changing the saved match', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    const participants = Array.from({ length: 4 }, (_, index) => ({ id: `participant-${index}`, name: `Player ${index}`, memberId: null }));
    const completed = {
      id: 'invalid-lineup', teams: [participants.slice(0, 2), participants.slice(2, 4)], status: 'completed' as const,
      winner: null, score: null, court: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z',
    };
    component['matches'].set([completed]);
    component['updateResult'](completed, { teams: [[participants[0], participants[0]], participants.slice(2, 4)] });
    component['saveResult'](completed);
    expect(component['resultError']()).toContain('four different players');
    expect(component['matches']()).toEqual([completed]);
  });

  it('ends a match without a result and returns every player to the regular line', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();

    const match = component['ongoingMatches']()[0];
    component['saveResult'](match);

    expect(component['ongoingMatches']()).toHaveLength(0);
    expect(component['completedMatches']()[0]).toMatchObject({ winner: null, score: null });
    expect(component['queue']().slice(-4)).toEqual(players.map((player) => player.id));
    expect(component['winnersQueue']()).toHaveLength(0);
    expect(players.map((player) => component['playerRecord'](player))).toEqual(Array(4).fill({ wins: 0, losses: 0 }));

    let completed = component['completedMatches']()[0];
    component['editingMatch'].set(completed.id);
    component['updateResult'](completed, { winner: '1' });
    component['saveResult'](completed);
    expect(component['winnersQueue']()).toEqual(players.slice(0, 2).map((player) => player.id));
    completed = component['completedMatches']()[0];
    component['editingMatch'].set(completed.id);
    component['updateResult'](completed, { winner: '' });
    component['saveResult'](completed);
    expect(component['queue']().slice(-4)).toEqual(players.map((player) => player.id));
    expect(component['winnersQueue']()).toHaveLength(0);
  });

  it('shows ongoing matches above preparation and completed matches in history', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    component['addCourt']();
    players.slice(0, 4).forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    const first = component['ongoingMatches']()[0];
    component['updateResult'](first, { winner: '1' });
    component['saveResult'](first);
    component['updateSelectedCourt']('2');
    players.slice(4).forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    fixture.detectChanges();

    const ongoing = fixture.nativeElement.querySelector('[aria-labelledby="ongoing-matches-heading"]') as HTMLElement;
    const preparation = fixture.nativeElement.querySelector('[aria-labelledby="next-players-heading"]') as HTMLElement;
    const completed = fixture.nativeElement.querySelector('[aria-labelledby="matches-heading"]') as HTMLElement;
    expect(ongoing.compareDocumentPosition(preparation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ongoing.querySelectorAll('.match-row')).toHaveLength(1);
    expect(ongoing.textContent).toContain('Match 2');
    expect(completed.querySelectorAll('.match-row')).toHaveLength(1);
    expect(completed.textContent).toContain('Match 1');
    const ongoingMatch = component['ongoingMatches']()[0];
    component['updateResult'](ongoingMatch, { team1: '3' });
    component['saveResult'](ongoingMatch);
    fixture.detectChanges();
    expect(ongoing.querySelector('[role="alert"]')?.textContent).toContain('Select a winner');
    expect(completed.querySelector('[role="alert"]')).toBeNull();

    const second = component['ongoingMatches']()[0];
    component['updateResult'](second, { winner: '2', team1: '', team2: '' });
    component['saveResult'](second);
    fixture.detectChanges();
    expect(ongoing.querySelectorAll('.match-row')).toHaveLength(0);
    expect(completed.querySelectorAll('.match-row')).toHaveLength(2);
    expect(completed.textContent).toContain('Match 2');

    component['editingMatch'].set(first.id);
    component['updateResult'](first, { winner: '', team1: '4' });
    component['saveResult'](first);
    fixture.detectChanges();
    expect(completed.querySelector('[role="alert"]')?.textContent).toContain('Select a winner');
  });

  it('swaps selected players and does not start with an unavailable player', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['updateMatchSlot'](3, players[0].id);
    expect(component['matchSlots']()[0]).toBe(players[3].id);
    expect(component['matchSlots']()[3]).toBe(players[0].id);
    expect(new Set(component['matchSlots']()).size).toBe(4);
    component['updateStatus'](players[3].id, 'Rest');
    component['startMatch']();
    expect(component['matches']()).toHaveLength(0);
  });

  it('configures multiple categories and retains court snapshots after completion and removal', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['addCourt']();
    component['newCourtCategory'].set('Intermediate');
    component['newCourtName'].set('  East Hall  ');
    component['addCourt']();
    component['addCourt']();
    component['newCourtCategory'].set('High Intermediate');
    component['addCourt']();
    expect(component['courts']()).toEqual([
      { number: 1, name: 'Court 1', category: 'Novice' }, { number: 2, name: 'East Hall', category: 'Intermediate' },
      { number: 3, name: 'Court 3', category: 'Intermediate' }, { number: 4, name: 'Court 4', category: 'High Intermediate' },
    ]);
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    component['selectedCourt'].set('2');
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['players']().forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    const match = component['ongoingMatches']()[0];
    expect(match.court).toEqual({ number: 2, name: 'East Hall', category: 'Intermediate' });
    component['updateResult'](match, { winner: '1' });
    component['saveResult'](match);
    component['removeCourt'](2);
    expect(component['completedMatches']()[0].court).toEqual({ number: 2, name: 'East Hall', category: 'Intermediate' });
    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    expect(request.request.body.courts).toHaveLength(3);
    expect(request.request.body.matches[0].court).toEqual({ number: 2, name: 'East Hall', category: 'Intermediate' });
    request.flush({ ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 });
    expect(component['isDirty']()).toBe(false);
  });

  it('shows court availability and disables changes while a match is in play', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    component['newCourtCategory'].set('Intermediate');
    component['addCourt']();
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['players']().forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const court = fixture.nativeElement.querySelector('.court-tile') as HTMLElement;
    expect(court.textContent).toContain('Court 1');
    expect(court.textContent).toContain('In play');
    expect((court.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
    expect((court.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.match-label').textContent).toContain('Court 1 (Intermediate)');
    component['selectedCourt'].set('1');
    component['startMatch']();
    expect(component['matchError']()).toContain('available court');
  });

  it('can assign an available court to an older unassigned ongoing match', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    const participant = { id: 'one', name: 'One', memberId: null };
    component['matches'].set([{
      id: 'legacy', teams: [[participant, { ...participant, id: 'two' }], [{ ...participant, id: 'three' }, { ...participant, id: 'four' }]],
      status: 'ongoing', winner: null, score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null,
    }]);
    component['addCourt']();
    const match = component['ongoingMatches']()[0];
    component['assignMatchCourt'](match, '1');
    expect(component['ongoingMatches']()[0].court).toEqual({ number: 1, name: 'Court 1', category: 'Novice' });
    expect(component['availableCourts']()).toHaveLength(0);
    expect(component['isDirty']()).toBe(true);
  });

  it('orders activated players, excludes those playing, and returns completed players to the end', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    expect(players.every((player) => player.status === 'Not Arrived')).toBe(true);
    expect(component['eligiblePlayers']()).toEqual([]);
    [1, 0, 2, 3, 4, 5].forEach((index) => component['updateStatus'](players[index].id, 'Active'));
    expect(component['eligiblePlayers']().map((player) => player.name)).toEqual(['Two', 'One', 'Three', 'Four', 'Five', 'Six']);
    component['updateStatus'](players[2].id, 'Rest');
    component['updateStatus'](players[2].id, 'Active');
    expect(component['eligiblePlayers']().map((player) => player.name)).toEqual(['Two', 'One', 'Four', 'Five', 'Six', 'Three']);
    component['addCourt']();
    [1, 0, 3, 4].forEach((index, slot) => component['updateMatchSlot'](slot, players[index].id));
    component['startMatch']();
    fixture.detectChanges();
    expect(component['eligiblePlayers']().map((player) => player.name)).toEqual(['Six', 'Three']);
    expect(fixture.nativeElement.querySelectorAll('.playing-status')).toHaveLength(4);
    component['updateStatus'](players[1].id, 'Rest');
    expect(component['players']()[1].status).toBe('Active');
    component['saveDraft']();
    const request = http.expectOne((item) => item.method === 'PUT');
    expect(request.request.body.queue).toEqual([1, 0, 3, 4, 5, 2].map((index) => players[index].id));
    const saved = { ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 };
    request.flush(saved);
    fixture.destroy();
    const restored = createPage(saved);
    const resumed = restored.componentInstance;
    expect(resumed['eligiblePlayers']().map((player) => player.name)).toEqual(['Six', 'Three']);
    const match = resumed['ongoingMatches']()[0];
    resumed['updateResult'](match, { winner: '1' });
    resumed['saveResult'](match);
    expect(resumed['normalLine']().map((player) => player.name)).toEqual(['Six', 'Three', 'Four', 'Five']);
    expect(resumed['winnersLine']().map((player) => player.name)).toEqual(['Two', 'One']);
    restored.detectChanges();
    const normal = restored.nativeElement.querySelector('[aria-labelledby="normal-line-heading"]') as HTMLElement;
    const winners = restored.nativeElement.querySelector('[aria-labelledby="winners-line-heading"]') as HTMLElement;
    expect([...normal.querySelectorAll('.queue-player')].map((item) => item.getAttribute('aria-label'))).toEqual(['Select or drag Six', 'Select or drag Three', 'Select or drag Four', 'Select or drag Five']);
    expect([...winners.querySelectorAll('.queue-player')].map((item) => item.getAttribute('aria-label'))).toEqual(['Select or drag Two', 'Select or drag One']);
    const completed = resumed['completedMatches']()[0];
    resumed['updateResult'](completed, { winner: '2' });
    resumed['saveResult'](completed);
    expect(resumed['normalLine']().map((player) => player.name)).toEqual(['Six', 'Three', 'Two', 'One']);
    expect(resumed['winnersLine']().map((player) => player.name)).toEqual(['Four', 'Five']);
    resumed['updateStatus'](players[5].id, 'Left');
    resumed['updateStatus'](players[5].id, 'Active');
    expect(resumed['normalLine']().at(-1)?.name).toBe('Six');
    resumed['saveDraft']();
    const result = http.expectOne((item) => item.method === 'PUT');
    expect(result.request.body.winnersQueue).toEqual([players[3].id, players[4].id]);
    const completedDraft = { ...result.request.body, revision: 'newer-revision', courtNameVersion: 1, queueVersion: 4 };
    result.flush(completedDraft);
    restored.destroy();
    const reloaded = createPage(completedDraft).componentInstance;
    expect(reloaded['normalLine']().map((player) => player.name)).toEqual(['Three', 'Two', 'One', 'Six']);
    expect(reloaded['winnersLine']().map((player) => player.name)).toEqual(['Four', 'Five']);
  });

  it('restores a canceled match to its original place in line', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    players.slice(0, 4).forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    component['cancelMatch'](component['ongoingMatches']()[0].id);
    expect(component['eligiblePlayers']().map((player) => player.name)).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
    vi.restoreAllMocks();
  });

  it('updates both lines on correction even while players are in a later canceled match', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['addCourt']();
    players.slice(0, 4).forEach((player, index) => component['updateMatchSlot'](index, player.id));
    component['startMatch']();
    const first = component['ongoingMatches']()[0];
    component['updateResult'](first, { winner: '1' });
    component['saveResult'](first);
    expect(component['normalLine']().map((player) => player.name)).toEqual(['Five', 'Six', 'Three', 'Four']);
    expect(component['winnersLine']().map((player) => player.name)).toEqual(['One', 'Two']);
    component['selectedCourt'].set('1');
    [0, 1, 4, 5].forEach((index, slot) => component['updateMatchSlot'](slot, players[index].id));
    component['startMatch']();
    const completed = component['completedMatches']()[0];
    component['updateResult'](completed, { winner: '2' });
    component['saveResult'](completed);
    expect(component['winnersLine']().map((player) => player.name)).toEqual(['Three', 'Four']);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    component['cancelMatch'](component['ongoingMatches']()[0].id);
    expect(component['normalLine']().map((player) => player.name)).toEqual(['Five', 'Six', 'One', 'Two']);
    expect(component['winnersLine']().map((player) => player.name)).toEqual(['Three', 'Four']);
    component['updateStatus'](players[2].id, 'Rest');
    component['updateStatus'](players[2].id, 'Active');
    expect(component['normalLine']().at(-1)?.name).toBe('Three');
    expect(component['winnersLine']().map((player) => player.name)).toEqual(['Four']);
    vi.restoreAllMocks();
  });

  it('does not reclassify players when an older result is corrected after a newer game at the same time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      for (const name of ['One', 'Two', 'Three', 'Four']) {
        component['guestName'].set(name);
        component['guestCategory'].set('Novice');
        component['addGuest']();
      }
      const players = component['players']();
      players.forEach((player) => component['updateStatus'](player.id, 'Active'));
      component['addCourt']();
      players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
      component['startMatch']();
      const first = component['ongoingMatches']()[0];
      component['updateResult'](first, { winner: '1' });
      component['saveResult'](first);
      component['selectedCourt'].set('1');
      players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
      component['startMatch']();
      const second = component['ongoingMatches']()[0];
      component['updateResult'](second, { winner: '1' });
      component['saveResult'](second);
      const older = component['matches']().find((match) => match.id === first.id)!;
      component['updateResult'](older, { winner: '2' });
      component['saveResult'](older);
      expect(component['normalLine']().map((player) => player.name)).toEqual(['Three', 'Four']);
      expect(component['winnersLine']().map((player) => player.name)).toEqual(['One', 'Two']);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses bench time during rest and play, resumes after cancellation, and resets after completion', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      for (const name of ['One', 'Two', 'Three', 'Four']) {
        component['guestName'].set(name);
        component['guestCategory'].set('Novice');
        component['addGuest']();
      }
      const players = component['players']();
      players.forEach((player) => component['updateStatus'](player.id, 'Active'));
      vi.advanceTimersByTime(10 * 60000);
      component['updateStatus'](players[0].id, 'Rest');
      vi.advanceTimersByTime(20 * 60000);
      expect(benchMilliseconds(component['bench']()[players[0].id], Date.now())).toBe(10 * 60000);
      component['updateStatus'](players[0].id, 'Active');
      vi.advanceTimersByTime(5 * 60000);
      component['addCourt']();
      players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
      component['startMatch']();
      vi.advanceTimersByTime(10 * 60000);
      expect(benchMilliseconds(component['bench']()[players[0].id], Date.now())).toBe(15 * 60000);
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      component['cancelMatch'](component['ongoingMatches']()[0].id);
      vi.advanceTimersByTime(5 * 60000);
      expect(benchMilliseconds(component['bench']()[players[0].id], Date.now())).toBe(20 * 60000);
      component['selectedCourt'].set('1');
      players.forEach((player, index) => component['updateMatchSlot'](index, player.id));
      component['startMatch']();
      vi.advanceTimersByTime(10 * 60000);
      const match = component['ongoingMatches']()[0];
      component['updateResult'](match, { winner: '1' });
      component['saveResult'](match);
      expect(benchMilliseconds(component['bench']()[players[0].id], Date.now())).toBe(0);
      fixture.destroy();
      vi.restoreAllMocks();
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns at 30 minutes and excludes resting players from the waiting comparison', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      component['guestName'].set('Waiting');
      component['guestCategory'].set('Novice');
      component['addGuest']();
      const waiting = component['players']()[0];
      component['updateStatus'](waiting.id, 'Active');
      vi.advanceTimersByTime(10 * 60000);
      component['guestName'].set('Recent');
      component['guestCategory'].set('Novice');
      component['addGuest']();
      const recent = component['players']()[1];
      component['updateStatus'](recent.id, 'Active');
      vi.advanceTimersByTime(19 * 60000);
      expect(component['waitIndicator'](waiting)).toBe('above-average');
      vi.advanceTimersByTime(60000);
      fixture.detectChanges();
      expect(component['waitIndicator'](waiting)).toBe('warning');
      expect(fixture.nativeElement.querySelector('.bench-warning')?.textContent).toContain('30+');
      component['updateStatus'](waiting.id, 'Rest');
      vi.advanceTimersByTime(10 * 60000);
      fixture.detectChanges();
      expect(component['normalLine']().map((entry) => entry.name)).toEqual(['Recent']);
      expect(benchMilliseconds(component['bench']()[waiting.id], Date.now())).toBe(30 * 60000);
      expect([...fixture.nativeElement.querySelectorAll('.queue-list .queue-player')].map((entry) => entry.getAttribute('aria-label'))).toEqual(['Select or drag Recent']);
      expect(component['waitIndicator'](recent)).toBe('warning');
      fixture.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('shows the top five by completed-game win percentage and updates after a result changes', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Unplayed']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    const snapshot = (index: number) => ({ id: players[index].id, name: players[index].name, memberId: null });
    const teams = [[snapshot(0), snapshot(1)], [snapshot(2), snapshot(3)]];
    component['matches'].set(Array.from({ length: 5 }, (_, index) => ({
      id: `result-${index}`, teams, status: 'completed' as const, winner: (index < 4 ? 1 : 2) as 1 | 2,
      score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:15:00Z', court: null,
    })).concat([{
      id: 'result-extra', teams: [[snapshot(4), snapshot(5)], [snapshot(2), snapshot(3)]], status: 'completed' as const,
      winner: 1 as 1 | 2, score: null, startedAt: '2026-11-08T11:00:00Z', completedAt: '2026-11-08T11:15:00Z', court: null,
    }]));
    fixture.detectChanges();
    expect(component['topPlayers']().map((entry) => entry.player.name)).toEqual(['Five', 'Six', 'One', 'Two', 'Four']);
    expect(component['winPercentage'](players[0])).toBe(80);
    expect(component['winPercentage'](players[6])).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.leaderboard li')).toHaveLength(5);
    const match = component['matches']()[0];
    component['updateResult'](match, { winner: '2' });
    component['saveResult'](match);
    expect(component['winPercentage'](players[0])).toBe(60);
  });

  it('prepares an overdue cross-line suggestion without starting a match', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      for (const name of ['Waiting Winner', 'One', 'Two', 'Three']) {
        component['guestName'].set(name);
        component['guestCategory'].set('Intermediate');
        component['addGuest']();
      }
      const players = component['players']();
      component['updateStatus'](players[0].id, 'Active');
      vi.advanceTimersByTime(30 * 60000);
      players.slice(1).forEach((player) => component['updateStatus'](player.id, 'Active'));
      component['queue'].set(players.slice(1).map((player) => player.id));
      component['winnersQueue'].set([players[0].id]);
      component['newCourtCategory'].set('Intermediate');
      component['addCourt']();
      expect(component['matchSlots']()).toContain(players[0].id);
      expect(component['nextSuggestion']()?.mixedLines).toBe(true);
      expect(component['ongoingMatches']()).toHaveLength(0);
      fixture.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('automatically previews the line with greater total wait before court selection and preserves manual swaps', async () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['Normal 1', 'Normal 2', 'Normal 3', 'Normal 4', 'Winner 1', 'Winner 2', 'Winner 3', 'Winner 4']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Intermediate');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['queue'].set(players.slice(0, 4).map((player) => player.id));
    component['winnersQueue'].set(players.slice(4).map((player) => player.id));
    const now = Date.now();
    component['bench'].set(Object.fromEntries(players.map((player, index) => [player.id, {
      accumulatedMs: 0, since: new Date(now - (index < 4 ? 10 : 20) * 60000).toISOString(),
    }])));
    component['now'].set(now);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['matchSlots']().every((id) => players.slice(4).some((player) => player.id === id))).toBe(true);
    expect(component['selectedCourt']()).toBe('');
    expect((fixture.nativeElement.querySelector('.next-players button.primary') as HTMLButtonElement).disabled).toBe(true);
    component['updateMatchSlot'](0, players[0].id);
    const edited = [...component['matchSlots']()];
    component['now'].set(now + 60000);
    expect(component['matchSlots']()).toEqual(edited);
    component['updateMatchSlot'](0, edited[1]);
    expect(component['matchSlots']()[1]).toBe(edited[0]);
    expect(new Set(component['matchSlots']()).size).toBe(4);
    component['updateStatus'](players[0].id, 'Rest');
    expect(component['validMatchSlots']()).toBe(false);
    component['manualMatchSlots'].set(null);
    component['manualFollowingMatchSlots'].set(null);
    expect(component['validMatchSlots']()).toBe(true);
    component['newCourtCategory'].set('Intermediate');
    component['addCourt']();
    const chosen = [...component['matchSlots']()];
    component['selectSwapPlayer'](chosen[0]);
    component['startMatch']();
    expect(component['ongoingMatches']()[0].teams.flat().map((player) => player.id)).toEqual(chosen);
    expect(component['ongoingMatches']()[0].court?.number).toBe(1);
    expect(component['manualMatchSlots']()).toEqual(['', '', '', '']);
    expect(component['selectedSwapId']()).toBe('');
    expect(component['matchSlots']().filter(Boolean)).toHaveLength(0);
  });

  it('marks a suggested player unavailable at the front and keeps the other three while choosing a replacement', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const before = [...component['matchSlots']()];
    const removed = before[1];
    const clock = component['bench']()[removed];
    component['markUnavailable'](1);
    expect(component['queue']()[0]).toBe(removed);
    expect(component['unavailable']()).toEqual([removed]);
    expect(component['matchSlots']()[1]).toBe(players[4].id);
    expect(component['matchSlots']().filter((id) => before.includes(id))).toHaveLength(3);
    expect(component['bench']()[removed]).toEqual(clock);
    expect(component['eligiblePlayers']().some((player) => player.id === removed)).toBe(false);
    component['saveDraft']();
    const request = http.expectOne((entry) => entry.method === 'PUT');
    expect(request.request.body.unavailable).toEqual([removed]);
    const saved = { ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 };
    request.flush(saved);
    fixture.destroy();
    const restored = createPage(saved).componentInstance;
    expect(restored['queue']()[0]).toBe(removed);
    expect(restored['unavailable']()).toEqual([removed]);
    restored['markAvailable'](removed);
    expect(restored['unavailable']()).toEqual([]);
    expect(restored['eligiblePlayers']()[0].id).toBe(removed);
  });

  it('leaves a slot empty when no suitable replacement exists and prevents starting', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['markUnavailable'](0);
    expect(component['matchSlots']()[0]).toBe('');
    expect(component['validMatchSlots']()).toBe(false);
    expect(component['matchError']()).toContain('No suitable replacement');
  });

  it('puts unavailable winners at the front of the winners line and clears the flag on status changes', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['queue'].set([]);
    component['winnersQueue'].set(players.map((player) => player.id));
    const removed = component['matchSlots']()[1];
    component['markUnavailable'](1);
    expect(component['winnersQueue']()[0]).toBe(removed);
    component['updateStatus'](removed, 'Rest');
    expect(component['unavailable']()).toEqual([]);
    expect(component['winnersQueue']()).not.toContain(removed);
  });

  it('uses the other line when it is the only source of a suitable replacement', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Replacement']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['queue'].set([players[4].id]);
    component['winnersQueue'].set(players.slice(0, 4).map((player) => player.id));
    const before = [...component['matchSlots']()];
    component['markUnavailable'](0);
    expect(component['matchSlots']()[0]).toBe(players[4].id);
    expect(component['matchSlots']().filter((id) => before.includes(id))).toHaveLength(3);
    expect(component['winnersQueue']()[0]).toBe(before[0]);
  });

  it('replaces players by selecting a line player and clicking a slot', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    fixture.detectChanges();
    const source = fixture.nativeElement.querySelector('[aria-label="Select or drag Five"]') as HTMLButtonElement;
    source.click();
    fixture.detectChanges();
    expect(source.getAttribute('aria-pressed')).toBe('true');
    const target = fixture.nativeElement.querySelector('.slot-target') as HTMLButtonElement;
    expect(target.getAttribute('aria-label')).toContain('with Five');
    target.click();
    fixture.detectChanges();
    expect(component['matchSlots']()[0]).toBe(component['players']()[4].id);
    expect(target.textContent).toContain('Five');
    expect(component['selectedSwapId']()).toBe('');
  });

  it.each([[0, 1], [0, 2], [3, 0], [1, 1]])('swaps suggested players dragged from slot %i to slot %i', (sourceIndex, targetIndex) => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    const locks = [[players[0].id, players[1].id]];
    component['playerLocks'].set(locks);
    fixture.detectChanges();
    const before = [...component['matchSlots']()];
    const slots = fixture.nativeElement.querySelectorAll('.slot-target') as NodeListOf<HTMLButtonElement>;
    expect(slots[sourceIndex].draggable).toBe(true);
    let payload = '';
    const dataTransfer = { setData: (_type: string, value: string) => { payload = value; }, getData: () => payload, effectAllowed: '' };
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    slots[sourceIndex].dispatchEvent(dragStart);
    expect(component['draggingPlayerId']()).toBe(before[sourceIndex]);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    slots[targetIndex].dispatchEvent(drop);
    fixture.detectChanges();

    const expected = [...before];
    [expected[sourceIndex], expected[targetIndex]] = [before[targetIndex], before[sourceIndex]];
    expect(component['matchSlots']()).toEqual(expected);
    expect(new Set(component['matchSlots']()).size).toBe(4);
    expect(component['playerLocks']()).toEqual(locks);
    expect(component['draggingPlayerId']()).toBe('');
    const publish = http.expectOne((request) => request.url.endsWith('/open-play/board-state'));
    expect(publish.request.body.nextPlayerIds).toEqual(expected);
    publish.flush({});

    slots[targetIndex].dispatchEvent(dragStart);
    slots[targetIndex].dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(component['draggingPlayerId']()).toBe('');
  });

  it('accepts internal drag drops and ignores unrelated or unavailable players', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    players.forEach((player) => component['updateStatus'](player.id, 'Active'));
    let payload = '';
    const dataTransfer = { setData: (_type: string, value: string) => { payload = value; }, getData: () => payload, effectAllowed: '' };
    const event = { dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent;
    component['dragPlayer'](event, players[4].id);
    component['dropPlayer'](event, 0);
    expect(component['matchSlots']()[0]).toBe(players[4].id);
    payload = players[3].id;
    component['dropPlayer'](event, 0);
    expect(component['matchSlots']()[0]).toBe(players[4].id);
    component['markUnavailable'](0);
    component['dragPlayer'](event, players[4].id);
    expect(component['draggingPlayerId']()).toBe('');
  });

  it('exposes unavailable and restore actions on the slot and player line', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    component['players']().forEach((player) => component['updateStatus'](player.id, 'Active'));
    fixture.detectChanges();
    const name = component['slotPlayer'](component['matchSlots']()[0])!.name;
    (fixture.nativeElement.querySelector('.unavailable-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector('[aria-labelledby="normal-line-heading"] li') as HTMLElement;
    expect(first.textContent).toContain(name);
    expect(first.textContent).toContain('Not available');
    (first.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component['unavailable']()).toEqual([]);
    expect(component['normalLine']()[0].name).toBe(name);
  });

  it('requires saving initialized clocks from an existing roster', () => {
    const fixture = TestBed.createComponent(OpenPlayPageComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/open-play/draft')).flush({
      players: [], courts: [], matches: [], queue: [], winnersQueue: [], bench: {}, unavailable: [], playerLocks: [], nextPlayerIds: null, benchMigrationNeeded: true,
      revision: 'legacy', courtNameVersion: 1, queueVersion: 4,
    });
    http.expectOne((request) => request.url.endsWith('/open-play/members')).flush([]);
    fixture.detectChanges();
    expect(fixture.componentInstance['isDirty']()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('earlier waiting and rest periods were not recorded');
  });

  it('continues saved active waiting time across reloads', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const fixture = createPage();
      const component = fixture.componentInstance;
      component['guestName'].set('Waiting');
      component['guestCategory'].set('Novice');
      component['addGuest']();
      const player = component['players']()[0];
      component['updateStatus'](player.id, 'Active');
      vi.advanceTimersByTime(10 * 60000);
      component['saveDraft']();
      const request = http.expectOne((entry) => entry.method === 'PUT');
      const saved = { ...request.request.body, revision: 'new-revision', courtNameVersion: 1, queueVersion: 4 };
      request.flush(saved);
      fixture.destroy();
      vi.advanceTimersByTime(20 * 60000);
      const restored = createPage(saved);
      expect(benchMilliseconds(restored.componentInstance['bench']()[player.id], Date.now())).toBe(30 * 60000);
      expect(restored.componentInstance['waitIndicator'](restored.componentInstance['players']()[0])).toBe('warning');
      restored.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('resets a legacy resting participant clock when their match ends without making them active', () => {
    const fixture = createPage();
    const component = fixture.componentInstance;
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      component['guestName'].set(name);
      component['guestCategory'].set('Novice');
      component['addGuest']();
    }
    const players = component['players']();
    component['updateStatus'](players[0].id, 'Rest');
    players.slice(1).forEach((player) => component['updateStatus'](player.id, 'Active'));
    component['bench'].update((clocks) => ({ ...clocks, [players[0].id]: { accumulatedMs: 1800000, since: null } }));
    const participants = players.map(({ id, name, memberId }) => ({ id, name, memberId }));
    component['matches'].set([{
      id: 'legacy-playing', teams: [participants.slice(0, 2), participants.slice(2, 4)], status: 'ongoing', winner: null,
      score: null, startedAt: '2026-11-08T10:00:00Z', completedAt: null, court: null,
    }]);
    const match = component['ongoingMatches']()[0];
    component['updateResult'](match, { winner: '1' });
    component['saveResult'](match);
    expect(component['players']()[0].status).toBe('Rest');
    expect(component['bench']()[players[0].id]).toEqual({ accumulatedMs: 0, since: null });
    expect(component['eligiblePlayers']().some((player) => player.id === players[0].id)).toBe(false);
  });
});