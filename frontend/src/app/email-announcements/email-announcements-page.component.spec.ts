import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailAnnouncementsPageComponent } from './email-announcements-page.component';
import { routes } from '../app.routes';
import { memberAuthGuard } from '../member-auth.guard';
import { memberRoleGuard } from '../member-role.guard';

describe('Email announcement page', () => {
  let fixture: ComponentFixture<EmailAnnouncementsPageComponent>;
  let http: HttpTestingController;
  const members = [
    { memberId: 'one', name: 'First Player', email: 'one@example.com' },
    { memberId: 'two', name: 'Second Player', email: 'two@example.com' },
  ];
  const preview = {
    subject: 'Club news',
    html: '<p>Hello</p>',
    text: 'Hello',
    recipientCount: 50,
    fingerprint: 'hash',
  };
  const component = () => fixture.componentInstance;
  const text = () => (fixture.nativeElement as HTMLElement).textContent!;
  function load() {
    http
      .expectOne((request) => request.url.endsWith('/email-announcements/recipients'))
      .flush(members);
    http
      .expectOne((request) => request.url.endsWith('/clubs'))
      .flush([{ clubId: 'club-one', name: 'First club' }]);
    fixture.detectChanges();
  }
  function compose() {
    component()['subject'].set('Club news');
    component()['html'].set('<p>Hello</p>');
    component()['buildPreview']();
    const request = http.expectOne((item) => item.url.endsWith('/preview'));
    expect(request.request.withCredentials).toBe(true);
    request.flush(preview);
    fixture.detectChanges();
  }
  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [EmailAnnouncementsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmailAnnouncementsPageComponent);
    fixture.detectChanges();
    load();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('protects the separate page with authentication and admin role guards', () => {
    const route = routes.find((item) => item.path === 'email-announcements')!;
    expect(route.canActivate).toEqual([memberAuthGuard, memberRoleGuard]);
    expect(route.data?.['allowedRoles']).toEqual(['admin']);
  });

  it('supports all, club and selected-user payloads and retains selection when filtering', () => {
    compose();
    expect(text()).toContain('50 emails');
    component()['mode'].set('club');
    component()['clubId'].set('club-one');
    component()['buildPreview']();
    const club = http.expectOne((item) => item.url.endsWith('/preview'));
    expect(club.request.body.audience).toEqual({ mode: 'club', clubId: 'club-one' });
    club.flush({ ...preview, recipientCount: 1 });
    component()['mode'].set('users');
    component()['toggleMember']('one', true);
    component()['search'].set('Second');
    expect(component()['filteredMembers']()).toEqual([members[1]]);
    expect(component()['selectedIds']()).toEqual(['one']);
    expect(component()['preview']()).toBeNull();
    component()['buildPreview']();
    const selected = http.expectOne((item) => item.url.endsWith('/preview'));
    expect(selected.request.body.audience).toEqual({ mode: 'users', memberIds: ['one'] });
    selected.flush({ ...preview, recipientCount: 1 });
  });

  it('provides HTML formatting and invalidates preview after edits', () => {
    compose();
    const editor = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    editor.value = 'Hello';
    editor.setSelectionRange(0, 5);
    component()['format'](editor, '<strong>', '</strong>');
    expect(component()['html']()).toBe('<strong>Hello</strong>');
    expect(component()['preview']()).toBeNull();
  });

  it('requires confirmation, sends with the preview fingerprint, and blocks double clicks', () => {
    compose();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component()['send']();
    http.expectNone((item) => item.url.endsWith('/send'));
    confirm.mockReturnValue(true);
    component()['send']();
    component()['send']();
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('50 Mailgun emails'));
    const request = http.expectOne((item) => item.url.endsWith('/send'));
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toMatchObject({
      subject: 'Club news',
      fingerprint: 'hash',
      audience: { mode: 'all' },
    });
    const id: string = request.request.body.requestId;
    expect(sessionStorage.getItem('spaqueue-announcement-request')).toBe(id);
    request.flush({ requestId: id, status: 'completed', total: 50, accepted: 49, unconfirmed: 1 });
    fixture.detectChanges();
    expect(text()).toContain('49 of 50 accepted');
    expect(text()).toContain('Some deliveries could not be confirmed');
    component()['send']();
    http.expectNone((item) => item.url.endsWith('/send'));
  });

  it('keeps interrupted sends locked and allows status recovery without retrying', () => {
    compose();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['send']();
    const request = http.expectOne((item) => item.url.endsWith('/send'));
    const requestId: string = request.request.body.requestId;
    request.flush(
      { message: 'Connection interrupted' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    fixture.detectChanges();
    expect(text()).toContain('Do not resend automatically');
    component()['send']();
    http.expectNone((item) => item.url.endsWith('/send'));
    component()['checkStatus']();
    http
      .expectOne((item) => item.url.endsWith(`/${requestId}`))
      .flush({
        requestId,
        status: 'completed',
        total: 50,
        accepted: 50,
        unconfirmed: 0,
      });

    fixture.detectChanges();
    expect(text()).toContain('50 of 50 accepted');
  });

  it('preserves the draft and requires a new preview if recipients change before sending', () => {
    compose();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['send']();
    http
      .expectOne((item) => item.url.endsWith('/send'))
      .flush(
        {
          code: 'ANNOUNCEMENT_PREVIEW_CHANGED',
          message: 'The recipient list changed. Preview and confirm again.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    expect(component()['requestId']()).toBeNull();
    expect(component()['preview']()).toBeNull();
    expect(component()['subject']()).toBe('Club news');
    expect(component()['locked']()).toBe(false);
    expect(component()['error']()).toContain('Preview and confirm again');
    expect(sessionStorage.getItem('spaqueue-announcement-request')).toBeNull();
  });

  it('recovers the last send after a page reload and clears content for a new announcement', () => {
    fixture.destroy();
    const id = 'de305d54-75b4-431b-adb2-eb6b9e546014';
    sessionStorage.setItem('spaqueue-announcement-request', id);
    fixture = TestBed.createComponent(EmailAnnouncementsPageComponent);
    fixture.detectChanges();
    http
      .expectOne((item) => item.url.endsWith(`/${id}`))
      .flush({
        requestId: id,
        status: 'sending',
        total: 50,
        accepted: 5,
        unconfirmed: 0,
      });
    load();
    expect(text()).toContain('5 of 50 accepted');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component()['newAnnouncement']();
    expect(component()['requestId']()).toBeNull();
    expect(component()['preview']()).toBeNull();
    expect(component()['subject']()).toBe('');
    expect(sessionStorage.getItem('spaqueue-announcement-request')).toBeNull();
  });

  it('surfaces load and preview errors and rejects incomplete audiences locally', () => {
    component()['buildPreview']();
    expect(component()['error']()).toContain('Enter a subject');
    component()['subject'].set('News');
    component()['mode'].set('users');
    component()['buildPreview']();
    http.expectNone((item) => item.url.endsWith('/preview'));
    component()['mode'].set('all');
    component()['buildPreview']();
    http
      .expectOne((item) => item.url.endsWith('/preview'))
      .flush(
        { message: 'No eligible recipients match this audience.' },
        { status: 400, statusText: 'Bad Request' },
      );
    expect(component()['error']()).toContain('No eligible recipients');
  });
});
