import { HttpClient } from '@angular/common/http';
import { Directive, forwardRef, inject, Input } from '@angular/core';
import { AbstractControl, AsyncValidator, NG_ASYNC_VALIDATORS, ValidationErrors } from '@angular/forms';
import { catchError, map, Observable, of, switchMap, timer } from 'rxjs';
import { getApiBaseUrl } from './api-base-url';

@Directive({
  selector: '[appReclubNameValidator]',
  providers: [{
    provide: NG_ASYNC_VALIDATORS,
    useExisting: forwardRef(() => ReclubNameValidatorDirective),
    multi: true,
  }],
})
export class ReclubNameValidatorDirective implements AsyncValidator {
  private readonly http = inject(HttpClient);
  @Input() appReclubNameValidator: 'registration' | 'profile' = 'registration';

  validate(control: AbstractControl): Observable<ValidationErrors | null> {
    const name = typeof control.value === 'string' ? control.value.trim() : '';
    if (!name) return of(null);
    const path = this.appReclubNameValidator === 'profile' ? 'members/me' : 'members';
    return timer(300).pipe(
      switchMap(() => this.http.get<{ available: boolean }>(
        `${getApiBaseUrl()}/${path}/reclub-name-availability`,
        { params: { name }, withCredentials: this.appReclubNameValidator === 'profile' },
      )),
      map((result) => result.available ? null : { reclubNameTaken: true }),
      catchError(() => of({ reclubNameCheckFailed: true })),
    );
  }
}
