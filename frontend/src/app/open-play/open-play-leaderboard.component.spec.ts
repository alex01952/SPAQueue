import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { routes } from '../app.routes';
import { LandingPageComponent } from '../landing-page.component';
import { OpenPlayLeaderboardComponent } from './open-play-leaderboard.component';

describe('Open Play leaderboard', () => {
  const result = {
    month: '2026-11', year: '2026',
    monthly: [{ name: 'Monthly Reclub', profileImageUrl: `/open-play/leaderboard/images/monthly/1/${'a'.repeat(64)}`, wins: 12, losses: 3, games: 15, percent: 80 }],
    annual: [{ name: 'Annual Reclub', profileImageUrl: '', wins: 24, losses: 6, games: 30, percent: 80 }],
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows both periods on the public landing page without credentials', () => {
    const fixture = TestBed.createComponent(LandingPageComponent);
    fixture.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne('/open-play/leaderboard');
    expect(request.request.withCredentials).toBe(false);
    request.flush(result);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Monthly Reclub');
    expect(text).toContain('Annual Reclub');
    expect(text).toContain('2026-11');
    expect(text).toContain('80.0%');
    expect(text).toContain('15 completed games with a recorded winner');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.landing-header a[href="/login"]')).not.toBeNull();
    expect(element.querySelector('main > section')?.classList.contains('leaderboard-feature')).toBe(true);
    expect(element.querySelectorAll('.podium-player.champion')).toHaveLength(2);
    expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(routes.find((route) => route.path === 'open-play-leaderboard')?.canActivate).toBeUndefined();
  });

  it('shows circular profile images and falls back when photos are missing or fail to load', () => {
    const fixture = TestBed.createComponent(OpenPlayLeaderboardComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/open-play/leaderboard').flush(result);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const periods = element.querySelectorAll('.leaderboard-period');
    const image = periods[0].querySelector<HTMLImageElement>('.podium-avatar');
    expect(image?.tagName).toBe('IMG');
    expect(image?.getAttribute('src')).toContain(result.monthly[0].profileImageUrl);
    expect(image?.getAttribute('alt')).toBe('');
    expect(periods[1].querySelector('.avatar-placeholder')).not.toBeNull();
    image?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(periods[0].querySelector('img')).toBeNull();
    expect(periods[0].querySelector('.avatar-placeholder')).not.toBeNull();
    expect(periods[0].textContent).toContain('Monthly Reclub');
  });

  it('celebrates only the top three while retaining every ranked player in the table', () => {
    const fixture = TestBed.createComponent(OpenPlayLeaderboardComponent);
    fixture.detectChanges();
    const entries = Array.from({ length: 20 }, (_, index) => ({
      name: `Player ${index + 1}`, profileImageUrl: '', wins: 20 - index, losses: index, games: 20, percent: (20 - index) * 5,
    }));
    TestBed.inject(HttpTestingController).expectOne('/open-play/leaderboard').flush({
      ...result, monthly: entries, annual: entries,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.podium-player')).toHaveLength(6);
    expect(element.querySelectorAll('tbody tr')).toHaveLength(40);
    expect(element.querySelector('.podium-player.bronze')?.textContent).toContain('Player 3');
    expect(element.querySelector('.table-wrap')?.textContent).toContain('Player 20');
  });

  it('reports loading failures and retries, showing empty periods', () => {
    const fixture = TestBed.createComponent(OpenPlayLeaderboardComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/open-play/leaderboard').flush({}, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unable to load the leaderboard');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    http.expectOne('/open-play/leaderboard').flush({ ...result, monthly: [], annual: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.leaderboard-period').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('No members have qualified');
  });
});
