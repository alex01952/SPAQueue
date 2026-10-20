import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClubJoinRequestsPageComponent } from './club-join-requests-page.component';

describe('ClubJoinRequestsPageComponent', () => {
  async function configure() {
    await TestBed.configureTestingModule({
      imports: [ClubJoinRequestsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    return {
      fixture: TestBed.createComponent(ClubJoinRequestsPageComponent),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('locks request actions and shows processing feedback while a review is pending', async () => {
    const { fixture, http } = await configure();
    fixture.detectChanges();
    http.expectOne('/clubs/options').flush([{ clubId: 'club-1', name: 'Club One' }]);

    fixture.componentInstance['selectClub']('club-1');
    http.expectOne('/clubs/club-1/join-requests/pending').flush([
      {
        clubId: 'club-1',
        memberId: 'member-1',
        memberName: 'Member One',
        status: 'Pending',
        requestedAt: '2026-10-20T03:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.approve') as HTMLButtonElement).click();
    const review = http.expectOne('/clubs/club-1/join-requests/member-1');
    expect(review.request.method).toBe('PATCH');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Processing...');
    expect(
      [...fixture.nativeElement.querySelectorAll('.request-actions button')].every(
        (button: HTMLButtonElement) => button.disabled,
      ),
    ).toBe(true);
    expect((fixture.nativeElement.querySelector('select') as HTMLSelectElement).disabled).toBe(true);

    review.flush({});
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Member approved and added to the club.',
    );
    http.verify();
  });
});
