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
});
