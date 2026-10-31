import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ReclubNameValidatorDirective } from './reclub-name-validator.directive';

describe('ReclubNameValidatorDirective', () => {
  let validator: ReclubNameValidatorDirective;
  let http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    validator = TestBed.runInInjectionContext(() => new ReclubNameValidatorDirective());
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  it('skips blank optional names', async () => {
    expect(await firstValueFrom(validator.validate(new FormControl('  ')))).toBeNull();
    http.expectNone(() => true);
  });

  it.each([true, false])('checks trimmed case-sensitive names and maps available=%s', async (available) => {
    const result = firstValueFrom(validator.validate(new FormControl(' PlayerOne ')));
    http.expectNone(() => true);
    await vi.advanceTimersByTimeAsync(300);
    const request = http.expectOne((req) => req.url === '/members/reclub-name-availability');
    expect(request.request.params.get('name')).toBe('PlayerOne');
    expect(request.request.withCredentials).toBe(false);
    request.flush({ available });
    expect(await result).toEqual(available ? null : { reclubNameTaken: true });
  });

  it('uses the authenticated endpoint for profile editing', async () => {
    validator.appReclubNameValidator = 'profile';
    const result = firstValueFrom(validator.validate(new FormControl('PlayerOne')));
    await vi.advanceTimersByTimeAsync(300);
    const request = http.expectOne((req) => req.url === '/members/me/reclub-name-availability');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ available: true });
    expect(await result).toBeNull();
  });

  it('returns an explicit validation failure rather than allowing an unavailable check', async () => {
    const result = firstValueFrom(validator.validate(new FormControl('PlayerOne')));
    await vi.advanceTimersByTimeAsync(300);
    http.expectOne(() => true).flush({}, { status: 502, statusText: 'Bad Gateway' });
    expect(await result).toEqual({ reclubNameCheckFailed: true });
  });

  it('cancels stale checks when the control changes', async () => {
    const control = new FormControl('', { asyncValidators: (value) => validator.validate(value) });
    control.setValue('OldName');
    await vi.advanceTimersByTimeAsync(300);
    const oldRequest = http.expectOne(() => true);
    control.setValue('NewName');
    expect(oldRequest.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const newRequest = http.expectOne(() => true);
    expect(newRequest.request.params.get('name')).toBe('NewName');
    newRequest.flush({ available: true });
    expect(control.valid).toBe(true);
  });
});
