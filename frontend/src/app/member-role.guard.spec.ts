import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { routes } from './app.routes';
import { MemberAuthService, MemberRole } from './member-auth.service';
import { memberRoleGuard } from './member-role.guard';

describe('Balance staff route permissions', () => {
  const role = signal<MemberRole>('balance-staff');
  const authenticated = signal(true);
  beforeEach(() => {
    role.set('balance-staff');
    authenticated.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MemberAuthService, useValue: {
          member: () => ({ role: role() }),
          ensureAuthenticated: () => of(authenticated()),
        } },
      ],
    });
  });
  async function evaluate(path: string) {
    const config = routes.find((route) => route.path === path)!;
    const snapshot = new ActivatedRouteSnapshot();
    snapshot.data = config.data ?? {};
    const state = { url: `/${path}` } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => memberRoleGuard(snapshot, state));
    return isObservable(result) ? firstValueFrom(result) : result;
  }
  it('allows balance staff on balance and points management but not admin-only routes', async () => {
    expect(await evaluate('member-balances')).toBe(true);
    expect(await evaluate('member-points')).toBe(true);
    const others = routes.filter((route) => !['member-balances', 'member-points'].includes(route.path ?? '') && route.canActivate?.includes(memberRoleGuard));
    expect(others.length).toBeGreaterThan(0);
    for (const route of others) {
      const result = await evaluate(route.path!);
      expect(result).not.toBe(true);
      expect(TestBed.inject(Router).serializeUrl(result as ReturnType<Router['createUrlTree']>)).toContain('/home');
    }
  });
  it('keeps admins authorized and denies normal members, club owners and unauthenticated users', async () => {
    role.set('admin');
    expect(await evaluate('member-balances')).toBe(true);
    expect(await evaluate('member-points')).toBe(true);
    for (const denied of ['member', 'club-owner'] as const) {
      role.set(denied);
      expect(await evaluate('member-balances')).not.toBe(true);
      expect(await evaluate('member-points')).not.toBe(true);
    }
    role.set('balance-staff');
    authenticated.set(false);
    expect(await evaluate('member-balances')).not.toBe(true);
    expect(await evaluate('member-points')).not.toBe(true);
  });
});
