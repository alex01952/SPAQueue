import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AuthenticatedMember, MemberAuthService, MemberRole } from '../member-auth.service';
import { MemberProfilePageComponent } from './member-profile-page.component';

describe('MemberProfilePageComponent', () => {
  const currentMember = {
    memberId: 'current-member',
    name: 'Current Member',
    age: 30,
    gender: 'Female',
    duprId: 'CURRENT-DUPR',
    reClubId: 'CURRENT-RECLUB',
    profileImageUrl: '',
    skills: { serve: 5 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  async function configure(memberId?: string, role: MemberRole = 'member') {
    const member = signal<AuthenticatedMember>({ ...currentMember, emailValidated: true, role });
    const updateAuthenticatedMember = vi.fn((updated: AuthenticatedMember) => member.set(updated));
    await TestBed.configureTestingModule({
      imports: [MemberProfilePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap(memberId ? { memberId } : {})),
          },
        },
        {
          provide: MemberAuthService,
          useValue: { member: member.asReadonly(), updateAuthenticatedMember },
        },
      ],
    }).compileComponents();

    return {
      fixture: TestBed.createComponent(MemberProfilePageComponent),
      http: TestBed.inject(HttpTestingController),
      updateAuthenticatedMember,
    };
  }

  it('lets admins grant the default year, specify a custom date and remove Gold membership', async () => {
    const { fixture, http, updateAuthenticatedMember } = await configure(undefined, 'admin');
    fixture.detectChanges();
    http.expectOne('/admin/gold-membership/email-templates').flush([]);
    http.expectOne('/members/current-member/profile-validations').flush([]);
    const element = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    expect(element.textContent).toContain('1 year from today');
    expect(element.querySelector('input[type=date]')).toBeNull();

    element.querySelector<HTMLFormElement>('.membership-panel form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    const save = http.expectOne('/members/current-member/gold-membership');
    expect(save.request.method).toBe('PATCH');
    expect(save.request.withCredentials).toBe(true);
    expect(save.request.body).toEqual({});
    expect(element.querySelector<HTMLButtonElement>('.membership-panel button')?.disabled).toBe(true);
    component['saveGoldMembership']();
    http.expectNone('/members/current-member/gold-membership');
    save.flush({ memberId: 'current-member', goldMembershipExpiresOn: '9999-12-31' });
    fixture.detectChanges();
    expect(element.querySelector('.photo-panel.gold-member')).not.toBeNull();
    expect(element.textContent).toContain('Gold member');
    expect(updateAuthenticatedMember).toHaveBeenCalledWith(expect.objectContaining({ goldMembershipExpiresOn: '9999-12-31' }));

    const term = element.querySelector<HTMLSelectElement>('.membership-panel select')!;
    term.value = 'custom';
    term.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const date = element.querySelector<HTMLInputElement>('input[type=date]')!;
    expect(date.required).toBe(true);
    date.value = '9998-12-31';
    date.dispatchEvent(new Event('input'));
    component['saveGoldMembership']();
    const custom = http.expectOne('/members/current-member/gold-membership');
    expect(custom.request.body).toEqual({ expiresOn: '9998-12-31' });
    custom.flush({ memberId: 'current-member', goldMembershipExpiresOn: '9998-12-31' });
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.membership-actions button[type=button]')!.click();
    const remove = http.expectOne('/members/current-member/gold-membership');
    expect(remove.request.body).toEqual({ expiresOn: null });
    remove.flush({ memberId: 'current-member', goldMembershipExpiresOn: null });
    fixture.detectChanges();
    expect(element.querySelector('.photo-panel.gold-member')).toBeNull();
    expect(element.textContent).toContain('Gold membership removed.');
    http.verify();
  });

  it('lists templates with credentials and sends the selected blob name when saving, but not when removing', async () => {
    const { fixture, http } = await configure(undefined, 'admin');
    fixture.detectChanges();
    http.expectOne('/members/current-member/profile-validations').flush([]);
    const list = http.expectOne('/admin/gold-membership/email-templates');
    expect(list.request.withCredentials).toBe(true);
    list.flush([{ name: 'email-templates/gold-membership-beta.html', displayName: 'gold-membership-beta.html' }]);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelectorAll<HTMLSelectElement>('.membership-panel select')[1];
    expect(select.textContent).toContain('gold-membership-beta.html');
    select.value = 'email-templates/gold-membership-beta.html';
    select.dispatchEvent(new Event('change'));
    fixture.componentInstance['saveGoldMembership']();
    const save = http.expectOne('/members/current-member/gold-membership');
    expect(save.request.body).toEqual({ emailTemplate: 'email-templates/gold-membership-beta.html' });
    save.flush({ memberId: 'current-member', goldMembershipExpiresOn: '9999-12-31', emailStatus: 'accepted' });
    fixture.detectChanges();
    expect(element.textContent).toContain('Email accepted by the email provider.');
    fixture.componentInstance['saveGoldMembership'](true);
    const remove = http.expectOne('/members/current-member/gold-membership');
    expect(remove.request.body).toEqual({ expiresOn: null });
    remove.flush({ memberId: 'current-member', goldMembershipExpiresOn: null });
  });

  it('shows template loading errors and lets admins reload the list', async () => {
    const { fixture, http } = await configure(undefined, 'admin');
    fixture.detectChanges();
    http.expectOne('/members/current-member/profile-validations').flush([]);
    http.expectOne('/admin/gold-membership/email-templates')
      .flush({ message: 'Storage unavailable' }, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Storage unavailable');
    fixture.componentInstance['loadEmailTemplates']();
    http.expectOne('/admin/gold-membership/email-templates').flush([]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No HTML templates found');
  });

  it('keeps saved membership visible and warns when email submission is unconfirmed', async () => {
    const { fixture, http } = await configure(undefined, 'admin');
    fixture.detectChanges();
    http.expectOne('/members/current-member/profile-validations').flush([]);
    http.expectOne('/admin/gold-membership/email-templates').flush([]);
    fixture.componentInstance['selectedEmailTemplate'].set('email-templates/gold-membership-beta.html');
    fixture.componentInstance['saveGoldMembership']();
    http.expectOne('/members/current-member/gold-membership').flush({
      memberId: 'current-member', goldMembershipExpiresOn: '9999-12-31', emailStatus: 'unconfirmed',
    });
    fixture.detectChanges();
    expect(fixture.componentInstance['member']()?.goldMembershipExpiresOn).toBe('9999-12-31');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Check Mailgun logs');
  });

  it('validates a missing custom date and surfaces API errors without changing membership', async () => {
    const { fixture, http } = await configure(undefined, 'admin');
    fixture.detectChanges();
    http.expectOne('/admin/gold-membership/email-templates').flush([]);
    http.expectOne('/members/current-member/profile-validations').flush([]);
    const component = fixture.componentInstance;
    component['membershipTerm'].set('custom');
    component['saveGoldMembership']();
    http.expectNone('/members/current-member/gold-membership');
    expect(component['membershipError']()).toBe('Choose an expiry date.');
    component['customExpiry'].set('2020-01-01');
    component['saveGoldMembership']();
    http.expectOne('/members/current-member/gold-membership')
      .flush({ message: 'Expiry must be today or later.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain('Expiry must be today or later.');
    expect(component['isSavingMembership']()).toBe(false);
    expect(component['member']()?.goldMembershipExpiresOn).toBeUndefined();
    http.verify();
  });

  it('displays the exact stored expiry date without shifting it to the previous day in local time', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    http.expectOne('/members/current-member/profile-validations').flush([]);
    fixture.componentInstance['member'].update((member) => member && ({
      ...member, goldMembershipExpiresOn: '2027-10-28',
    }));
    fixture.detectChanges();
    const expiry = (fixture.nativeElement as HTMLElement).querySelector('.membership-panel time');
    expect(expiry?.getAttribute('datetime')).toBe('2027-10-28');
    expect(expiry?.textContent?.trim()).toBe('Oct 28, 2027');
    http.verify();
  });

  it.each<MemberRole>(['member', 'club-owner', 'balance-staff'])('hides membership controls from %s but displays the correct active or expired frame', async (role) => {
    const { fixture, http } = await configure(undefined, role);
    fixture.detectChanges();
    http.expectOne('/members/current-member/profile-validations').flush([]);
    const element = fixture.nativeElement as HTMLElement;
    fixture.componentInstance['member'].update((member) => member && ({ ...member, goldMembershipExpiresOn: '9999-12-31' }));
    fixture.detectChanges();
    expect(element.querySelector('.photo-panel.gold-member')).not.toBeNull();
    expect(element.querySelector('.membership-panel form')).toBeNull();
    fixture.componentInstance['saveGoldMembership']();
    http.expectNone('/members/current-member/gold-membership');
    fixture.componentInstance['member'].update((member) => member && ({ ...member, goldMembershipExpiresOn: '2020-01-01' }));
    fixture.detectChanges();
    expect(element.querySelector('.photo-panel.gold-member')).toBeNull();
    expect(element.textContent).toContain('Expired on');
    http.verify();
  });

  it('should render the authenticated member on the unparameterized route', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Current Member');
    expect(text).toContain('CURRENT-DUPR');
    http.expectNone(({ url }) => /\/members\/[^/]+$/.test(url));
    http
      .expectOne('/members/current-member/profile-validations')
      .flush([]);
    http.verify();
  });

  it('should request and render the member identified by the route row key', async () => {
    const { fixture, http } = await configure('selected-member-row-key');
    fixture.detectChanges();

    const request = http.expectOne(({ url, method }) =>
      method === 'GET' && url.endsWith('/members/selected-member-row-key'),
    );
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      memberId: 'selected-member-row-key',
      name: 'Selected Member',
      age: 29,
      gender: 'Non-binary',
      duprId: 'SELECTED-DUPR',
      reClubId: 'SELECTED-RECLUB',
      profileImageUrl: '',
      skills: { courtAwareness: 7 },
      createdAt: '2026-02-18T09:30:00.000Z',
    });
    http
      .expectOne('/members/selected-member-row-key/profile-validations')
      .flush([]);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Selected Member');
    expect(text).toContain('SELECTED-DUPR');
    expect(text).toContain('Court Awareness');
    expect(text).not.toContain('Current Member');
    expect(text).not.toContain('CURRENT-DUPR');
    http.verify();
  });

  it('classifies the 250 skill points in five 50-point bands next to the job', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    http
      .expectOne('/members/current-member/profile-validations')
      .flush([]);

    for (const [total, category] of [
      [0, 'Beginner'], [1, 'Beginner'], [50, 'Beginner'],
      [51, 'Novice'], [100, 'Novice'],
      [101, 'Low Intermediate'], [150, 'Low Intermediate'],
      [151, 'High Intermediate'], [200, 'High Intermediate'],
      [201, 'Advanced'], [250, 'Advanced'],
    ] as const) {
      const skills = Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [
          index === 0 ? 'serve' : `skill${index}`,
          Math.min(10, Math.max(0, total - index * 10)),
        ]),
      );
      fixture.componentInstance['member'].set({ ...currentMember, emailValidated: true, skills });
      fixture.detectChanges();
      expect(fixture.componentInstance['skillCategory']()).toBe(category);
      if (total > 0) {
        const heading = fixture.nativeElement.querySelector('.player-class-heading') as HTMLElement;
        expect(heading.querySelector('h2')?.textContent).toBeTruthy();
        expect(heading.querySelector('.skill-category')?.textContent?.trim()).toBe(category);
      }
    }

    http.verify();
  });

  it('maps the average 0–10 skill rating to the 2.0–5.0 DUPR range', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    http
      .expectOne('/members/current-member/profile-validations')
      .flush([]);

    fixture.componentInstance['member'].set({
      ...currentMember,
      emailValidated: true,
      skills: {},
    });
    expect(fixture.componentInstance['averageSkill']()).toBe('2.0');

    fixture.componentInstance['member'].set({
      ...currentMember,
      emailValidated: true,
      skills: { serve: 10, return: 10 },
    });
    expect(fixture.componentInstance['averageSkill']()).toBe('5.0');

    fixture.componentInstance['member'].set({
      ...currentMember,
      emailValidated: true,
      skills: { serve: 5, return: 5 },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance['averageSkill']()).toBe('3.5');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      '0–10 skill average mapped to 2.0–5.0 DUPR.',
    );
    http.verify();
  });

  it('shows officer validations on a member profile', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();

    http.expectOne('/members/current-member/profile-validations').flush([
      {
        officerName: 'Officer Alex',
        clubName: 'Sorsogon Pickleball',
        validatedAt: '2026-10-20T03:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Officer Alex',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Sorsogon Pickleball',
    );
    http.verify();
  });
});