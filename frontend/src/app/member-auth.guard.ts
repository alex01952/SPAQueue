import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { MemberAuthService } from './member-auth.service';

export const memberAuthGuard: CanActivateFn = (_route, state) => {
  const auth = inject(MemberAuthService);
  const router = inject(Router);

  return auth.ensureAuthenticated().pipe(
    map((authenticated) =>
      authenticated
        ? true
        : router.createUrlTree(['/login'], {
            queryParams: { returnUrl: state.url },
          }),
    ),
  );
};