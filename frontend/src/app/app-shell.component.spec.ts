import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppShellComponent } from './app-shell.component';

@Component({ template: '' })
class EmptyPageComponent {}

describe('AppShellComponent breadcrumbs', () => {
  it('should hide breadcrumbs on Home and show the current route elsewhere', async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([
          { path: 'home', component: EmptyPageComponent, title: 'Member Home' },
          { path: 'members', component: EmptyPageComponent, title: 'Members' },
          {
            path: 'member-profile/:memberId',
            component: EmptyPageComponent,
            title: 'Member Profile',
            data: {
              breadcrumbParent: { label: 'Members', route: '/members' },
            },
          },
        ]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppShellComponent);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/home');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.breadcrumbs')).toBeNull();

    await router.navigateByUrl('/members');
    fixture.detectChanges();
    const breadcrumbs = fixture.nativeElement.querySelector(
      '.breadcrumbs',
    ) as HTMLElement;
    const homeLink = breadcrumbs.querySelector('a') as HTMLAnchorElement;

    expect(breadcrumbs.textContent).toContain('Home');
    expect(breadcrumbs.textContent).toContain('Members');
    expect(homeLink.getAttribute('href')).toBe('/home');

    await router.navigateByUrl('/member-profile/member-row-key');
    fixture.detectChanges();
    const profileBreadcrumbs = fixture.nativeElement.querySelector(
      '.breadcrumbs',
    ) as HTMLElement;
    const links = Array.from(
      profileBreadcrumbs.querySelectorAll<HTMLAnchorElement>('a'),
    );

    expect(
      Array.from(profileBreadcrumbs.querySelectorAll('li')).map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Home', '/', 'Members', '/', 'Member Profile']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/home',
      '/members',
    ]);
  });
});