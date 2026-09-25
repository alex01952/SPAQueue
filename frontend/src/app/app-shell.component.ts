import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationError,
  NavigationEnd,
  NavigationStart,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly currentPageTitle = signal('');
  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/SPCLogo.png';
  protected readonly isNavigating = signal(false);
  protected readonly breadcrumbParent = signal<{
    label: string;
    route: string;
  } | null>(null);
  private readonly currentRoutePath = signal('');
  protected readonly showBreadcrumbs = computed(
    () =>
      this.currentRoutePath() !== '/' &&
      this.currentRoutePath() !== '/home' &&
      !!this.currentPageTitle(),
  );

  constructor() {
    this.router.events
      .pipe(
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.isNavigating.set(true);
          return;
        }

        if (event instanceof NavigationEnd) {
          this.currentRoutePath.set(event.urlAfterRedirects.split('?')[0]);
          this.updateCurrentPageTitle();
          this.isNavigating.set(false);
          return;
        }

        if (event instanceof NavigationCancel || event instanceof NavigationError) {
          this.isNavigating.set(false);
        }
      });
  }

  private updateCurrentPageTitle() {
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
    }

    this.currentPageTitle.set(route.title ?? 'Page');
    const parent = route.data['breadcrumbParent'];
    this.breadcrumbParent.set(
      parent && typeof parent.label === 'string' && typeof parent.route === 'string'
        ? parent
        : null,
    );
  }
}