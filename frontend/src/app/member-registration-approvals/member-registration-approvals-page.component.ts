import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { getApiBaseUrl } from '../api-base-url';
import { MemberProfileFrameComponent } from '../member-profile/member-profile-frame.component';

interface PendingMemberRegistration {
  memberId: string;
  name: string;
  email: string;
  createdAt: string;
  emailValidated: boolean;
}

@Component({
  selector: 'app-member-registration-approvals-page',
  imports: [DatePipe, MemberProfileFrameComponent],
  templateUrl: './member-registration-approvals-page.component.html',
  styleUrl: './member-registration-approvals-page.component.scss',
})
export class MemberRegistrationApprovalsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly registrations = signal<PendingMemberRegistration[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly approvingMemberId = signal('');
  protected readonly profileMember = signal<PendingMemberRegistration | null>(null);
  protected readonly feedbackMessage = signal('');
  protected readonly errorMessage = signal('');

  ngOnInit() {
    this.loadRegistrations();
  }

  protected approve(registration: PendingMemberRegistration) {
    if (!registration.emailValidated || this.approvingMemberId()) return;

    this.approvingMemberId.set(registration.memberId);
    this.feedbackMessage.set('');
    this.errorMessage.set('');
    this.http
      .patch(
        `${getApiBaseUrl()}/admin/member-registrations/${encodeURIComponent(registration.memberId)}/approve`,
        {},
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.registrations.update((items) =>
            items.filter((item) => item.memberId !== registration.memberId),
          );
          this.feedbackMessage.set(`${registration.name}'s registration was approved.`);
          this.approvingMemberId.set('');
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(error.error?.message ?? 'The registration could not be approved.');
          this.approvingMemberId.set('');
        },
      });
  }

  protected showProfile(registration: PendingMemberRegistration) {
    this.profileMember.set(registration);
  }

  protected closeProfile() {
    this.profileMember.set(null);
  }

  private loadRegistrations() {
    this.http
      .get<
        PendingMemberRegistration[]
      >(`${getApiBaseUrl()}/admin/member-registrations/pending`, { withCredentials: true })
      .subscribe({
        next: (registrations) => {
          this.registrations.set(registrations);
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Pending registrations could not be loaded.',
          );
          this.isLoading.set(false);
        },
      });
  }
}
