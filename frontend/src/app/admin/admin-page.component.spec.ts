import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { routes } from '../app.routes';
import { memberAuthGuard } from '../member-auth.guard';
import { memberRoleGuard } from '../member-role.guard';
import { AdminPageComponent } from './admin-page.component';

describe('AdminPageComponent', () => {
  it('lists every moved admin menu destination, including reward configuration and redemption history', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.home-menu a'));

    expect(links.map((link) => link.querySelector('strong')?.textContent)).toEqual([
      'Gold membership applications',
      'Member contacts', 'Manage member roles', 'Rewards store', 'Email announcements', 'Open Play matching', 'Open Play import presets', 'Upload participation',
      'Registration approvals', 'Manage clubs', 'Manage tournaments',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/gold-membership-applications',
      '/member-contacts', '/member-role-management', '/store-admin', '/email-announcements', '/open-play-matching', '/open-play-import-presets',
      '/open-play-participation/upload', '/member-registration-approvals',
      '/club-management', '/tournament-management',
    ]);
    expect(links.find((link) => link.getAttribute('href') === '/store-admin')?.textContent).toContain('view all redemptions');
    expect(compiled.querySelector('a[href="/home"]')?.textContent).toContain('Back to Member Home');
    expect(routes.some((route) => route.path === 'queue-dashboard')).toBe(false);

    for (const path of ['admin', ...links.map((link) => link.getAttribute('href')!.slice(1))]) {
      const route = routes.find((entry) => entry.path === path)!;
      expect(route.canActivate).toContain(memberAuthGuard);
      expect(route.canActivate).toContain(memberRoleGuard);
      expect(route.data?.['allowedRoles']).toEqual(['open-play-matching', 'open-play-import-presets'].includes(path)
        ? ['admin', 'balance-staff']
        : ['admin']);
      if (path !== 'admin') {
        expect(route.data?.['breadcrumbParent']).toEqual(['open-play-matching', 'open-play-import-presets'].includes(path)
          ? { label: 'Member Home', route: '/home' }
          : { label: 'Admin', route: '/admin' });
      }
    }
  });
});
