import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
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
  protected readonly breadcrumbParent = signal<{
    label: string;
    route: string;
  } | null>(null);
  private readonly currentRoutePath = signal('');
  protected readonly showBreadcrumbs = computed(
    () => this.currentRoutePath() !== '/home' && !!this.currentPageTitle(),
  );

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentRoutePath.set(event.urlAfterRedirects.split('?')[0]);
        this.updateCurrentPageTitle();
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