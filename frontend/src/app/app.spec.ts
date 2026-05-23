import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  let httpTestingController: HttpTestingController;

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
    const request = httpTestingController.expectOne('http://localhost:3000/queue?courtCount=1');
    request.flush({
      players: [],
      ongoingGames: [],
      recentGames: [],
      nextGame: { courtCount: 1, eligiblePlayers: [], selectedPlayers: [], courts: [] },
    });
    expect(app).toBeTruthy();
  });

  it('should render the dashboard heading', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const request = httpTestingController.expectOne('http://localhost:3000/queue?courtCount=1');
    request.flush({
      players: [],
      ongoingGames: [],
      recentGames: [],
      nextGame: { courtCount: 1, eligiblePlayers: [], selectedPlayers: [], courts: [] },
    });
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Run the next game without double-booking the court.',
    );
  });
});
