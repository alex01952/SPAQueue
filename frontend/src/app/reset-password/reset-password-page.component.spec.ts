import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ResetPasswordPageComponent } from './reset-password-page.component';

describe('ResetPasswordPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ token: 'reset-token' }) } } }],
    }).compileComponents();
  });

  it('checks confirmation and submits the new password', () => {
    const fixture = TestBed.createComponent(ResetPasswordPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance['password'] = 'new-password';
    fixture.componentInstance['confirmation'] = 'different';
    fixture.componentInstance['submit']();
    expect(fixture.componentInstance['error']()).toContain('do not match');
    http.expectNone('/members/password-reset/confirm');
    fixture.componentInstance['confirmation'] = 'new-password';
    fixture.componentInstance['submit']();
    const request = http.expectOne('/members/password-reset/confirm');
    expect(request.request.body).toEqual({ token: 'reset-token', password: 'new-password' });
    request.flush({ reset: true });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Your password has been updated');
    http.verify();
  });

  it('shows an actionable error for an expired link', () => {
    const fixture = TestBed.createComponent(ResetPasswordPageComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance['password'] = 'new-password';
    fixture.componentInstance['confirmation'] = 'new-password';
    fixture.componentInstance['submit']();
    http.expectOne('/members/password-reset/confirm').flush({}, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('invalid or expired');
    http.verify();
  });
});