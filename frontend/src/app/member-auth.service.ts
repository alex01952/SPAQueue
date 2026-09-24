import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { getApiBaseUrl } from './api-base-url';

export interface AuthenticatedMember {
  memberId: string;
  name: string;
  age: number | null;
  gender: string;
  duprId: string;
  reClubId: string;
  profileImageUrl: string;
  skills: Record<string, number | null>;
  createdAt: string;
  emailValidated: boolean;
}

export interface MemberAccountDetails extends AuthenticatedMember {
  email: string;
  contactNo: string;
  emergencyContact: string;
}

interface MemberSessionResponse {
  authenticated: true;
  member: AuthenticatedMember;
}

@Injectable({ providedIn: 'root' })
export class MemberAuthService {
  private readonly http = inject(HttpClient);
  private readonly authenticatedMember = signal<AuthenticatedMember | null>(null);

  readonly member = this.authenticatedMember.asReadonly();

  login(email: string, password: string): Observable<AuthenticatedMember> {
    return this.http
      .post<MemberSessionResponse>(
        `${getApiBaseUrl()}/members/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(
        tap((session) => this.authenticatedMember.set(session.member)),
        map((session) => session.member),
      );
  }

  ensureAuthenticated(): Observable<boolean> {
    return this.http
      .get<MemberSessionResponse>(`${getApiBaseUrl()}/members/session`, {
        withCredentials: true,
      })
      .pipe(
        tap((session) => this.authenticatedMember.set(session.member)),
        map(() => true),
        catchError(() => {
          this.authenticatedMember.set(null);
          return of(false);
        }),
      );
  }

  logout(): Observable<void> {
    return this.http
      .post<void>(
        `${getApiBaseUrl()}/members/logout`,
        {},
        { withCredentials: true },
      )
      .pipe(tap(() => this.authenticatedMember.set(null)));
  }

  updateAuthenticatedMember(member: AuthenticatedMember) {
    this.authenticatedMember.set(member);
  }

  requestEmailVerification(): Observable<{ sent: true; email: string }> {
    return this.http.post<{ sent: true; email: string }>(
      `${getApiBaseUrl()}/members/email-verification/request`,
      {},
      { withCredentials: true },
    );
  }

  confirmEmailVerification(token: string): Observable<{ verified: true }> {
    return this.http
      .post<{ verified: true }>(
        `${getApiBaseUrl()}/members/email-verification/confirm`,
        { token },
      )
      .pipe(
        tap(() => {
          const member = this.authenticatedMember();
          if (member) {
            this.authenticatedMember.set({ ...member, emailValidated: true });
          }
        }),
      );
  }
}