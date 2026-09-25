import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { MemberAuthService, MemberRole } from './member-auth.service';

export const memberRoleGuard: CanActivateFn = (route, state) => {
  const auth = inject(MemberAuthService);
  const router = inject(Router);
  const allowedRoles = (route.data['allowedRoles'] ?? []) as MemberRole[];

  return auth.ensureAuthenticated().pipe(
    map((authenticated) => {
      const role = auth.member()?.role ?? 'member';
      return authenticated && allowedRoles.includes(role)
        ? true
        : router.createUrlTree(['/home'], {
            queryParams: { returnUrl: state.url },
          });
    }),
  );
};