import { Injectable } from '@angular/core';
import { of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardAuthService {
  private readonly storageKey = 'spaqueue.dashboardPassword';

  getAuthHeaders() {
    return {
      'x-dashboard-password': this.getStoredPassword() ?? '',
    };
  }

  ensureAuthenticated() {
    if (this.getStoredPassword()) {
      return of(true);
    }

    return this.promptForPassword();
  }

  clearPassword() {
    this.clearStoredPassword();
  }

  private promptForPassword() {
    const password = window.prompt('Enter the dashboard password');

    if (password === null || !password.trim()) {
      return of(false);
    }

    this.storePassword(password);

    return of(true);
  }

  private getStoredPassword() {
    try {
      return sessionStorage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }

  private storePassword(password: string) {
    try {
      sessionStorage.setItem(this.storageKey, password);
    } catch {
      // If storage is unavailable, the next protected route visit will prompt again.
    }
  }

  private clearStoredPassword() {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      // Ignore storage access failures.
    }
  }
}
