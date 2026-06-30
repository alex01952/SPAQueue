import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { DashboardAuthService } from './dashboard-auth.service';

export const dashboardAuthGuard: CanActivateFn = () =>
  inject(DashboardAuthService).ensureAuthenticated();
