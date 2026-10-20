import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClubAdminPageComponent } from './club-admin-page.component';

describe('ClubAdminPageComponent', () => {
  it('should create a club and assign an officer', async () => {
    await TestBed.configureTestingModule({
      imports: [ClubAdminPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClubAdminPageComponent);
    const component = fixture.componentInstance as any;
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http
      .expectOne(({ url, method }) => method === 'GET' && url.endsWith('/clubs/options'))
      .flush([]);
    http
      .expectOne(({ url, method }) => method === 'GET' && url.endsWith('/members'))
      .flush([{ memberId: 'member-1', name: 'Alex Member' }]);
    http
      .expectOne(({ url, method }) => method === 'GET' && url.endsWith('/admin/club-members'))
      .flush([]);

    component.newClubName.set('Sorsogon City Pickleball');
    component.createClub();
    const createRequest = http.expectOne(
      ({ url, method }) => method === 'POST' && url.endsWith('/admin/clubs'),
    );
    expect(createRequest.request.body).toEqual({
      name: 'Sorsogon City Pickleball',
    });
    createRequest.flush({
      clubId: 'sorsogon-city-pickleball',
      name: 'Sorsogon City Pickleball',
    });

    component.selectedMemberId.set('member-1');
    component.assignOfficer();
    const assignmentRequest = http.expectOne(
      ({ url, method }) => method === 'POST' && url.endsWith('/admin/club-members'),
    );
    expect(assignmentRequest.request.body).toEqual({
      clubId: 'sorsogon-city-pickleball',
      memberId: 'member-1',
      role: 'Officer',
    });
    assignmentRequest.flush({
      clubId: 'sorsogon-city-pickleball',
      memberId: 'member-1',
      role: 'Officer',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Club officer assigned.');
    expect(fixture.nativeElement.textContent).toContain('Alex Member');
    expect(fixture.nativeElement.textContent).toContain('Sorsogon City Pickleball');
    http.verify();
  });

  it('shows only officers from the club selected in the current officer filter', async () => {
    await TestBed.configureTestingModule({
      imports: [ClubAdminPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClubAdminPageComponent);
    const component = fixture.componentInstance as any;
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    http
      .expectOne(({ url }) => url.endsWith('/clubs/options'))
      .flush([
        { clubId: 'club-1', name: 'First Club' },
        { clubId: 'club-2', name: 'Second Club' },
      ]);
    http
      .expectOne(({ url }) => url.endsWith('/members'))
      .flush([
        { memberId: 'member-1', name: 'First Officer' },
        { memberId: 'member-2', name: 'Second Officer' },
      ]);
    http
      .expectOne(({ url }) => url.endsWith('/admin/club-members'))
      .flush([
        { clubId: 'club-1', memberId: 'member-1', role: 'Officer' },
        { clubId: 'club-2', memberId: 'member-2', role: 'Officer' },
      ]);
    fixture.detectChanges();

      const officerList = fixture.nativeElement.querySelector(
        '.officer-list',
      ) as HTMLElement;
      expect(officerList.textContent).toContain('First Officer');
      expect(officerList.textContent).not.toContain('Second Officer');

      component.selectedOfficerClubId.set('club-2');
      fixture.detectChanges();

      expect(officerList.textContent).not.toContain('First Officer');
      expect(officerList.textContent).toContain('Second Officer');
    http.verify();
  });
});
