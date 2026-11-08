import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { MemberRole, MemberAuthService } from '../member-auth.service';
import { getApiBaseUrl } from '../api-base-url';

interface MemberRoleEntry {
  memberId: string;
  name: string;
  role: string;
  clubName: string;
}

interface RoleUpdateResult {
  memberId: string;
  role: MemberRole;
}

const MEMBER_ROLES: readonly { value: MemberRole; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'club-owner', label: 'Club owner' },
  { value: 'balance-staff', label: 'Balance staff' },
  { value: 'admin', label: 'Admin' },
];

@Component({
  selector: 'app-member-role-management-page',
  templateUrl: './member-role-management-page.component.html',
  styleUrl: './member-role-management-page.component.scss',
})
export class MemberRoleManagementPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(MemberAuthService);
  protected readonly roles = MEMBER_ROLES;
  protected readonly members = signal<MemberRoleEntry[]>([]);
  protected readonly roleChanges = signal<Record<string, MemberRole>>({});
  protected readonly searchTerm = signal('');
  protected readonly isLoading = signal(true);
  protected readonly savingMemberId = signal('');
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');

  protected readonly filteredMembers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.members();
    return this.members().filter((member) =>
      [member.name, member.memberId, member.role, member.clubName].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  });

  ngOnInit() {
    this.loadMembers();
  }

  protected loadMembers() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.http.get<MemberRoleEntry[]>(`${getApiBaseUrl()}/members`, { withCredentials: true })
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.roleChanges.set({});
          this.isLoading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(error.status === 401
            ? 'Your member session has expired. Sign in again.'
            : 'Unable to load members. Please try again.');
        },
      });
  }

  protected updateSearchTerm(value: string) {
    this.searchTerm.set(value);
  }

  protected selectedRole(member: MemberRoleEntry): MemberRole {
    return this.roleChanges()[member.memberId] ?? this.normalizedRole(member.role);
  }

  protected setRole(member: MemberRoleEntry, value: string) {
    if (this.roles.some((role) => role.value === value)) {
      this.roleChanges.update((changes) => ({ ...changes, [member.memberId]: value as MemberRole }));
      this.errorMessage.set('');
      this.feedbackMessage.set('');
    }
  }

  protected isChanged(member: MemberRoleEntry) {
    return this.selectedRole(member) !== this.normalizedRole(member.role);
  }

  protected isCurrentAdmin(member: MemberRoleEntry) {
    return member.memberId === this.auth.member()?.memberId && this.normalizedRole(member.role) === 'admin';
  }

  protected saveRole(member: MemberRoleEntry) {
    const role = this.selectedRole(member);
    if (!this.isChanged(member) || this.savingMemberId() || this.isCurrentAdmin(member)) return;
    if (role === 'admin' && !window.confirm(`Grant admin access to ${member.name}? Admins can manage all member and club operations.`)) return;

    this.savingMemberId.set(member.memberId);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.patch<RoleUpdateResult>(
      `${getApiBaseUrl()}/members/${encodeURIComponent(member.memberId)}/role`,
      { role },
      { withCredentials: true },
    ).subscribe({
      next: (result) => {
        this.members.update((members) => members.map((item) =>
          item.memberId === result.memberId ? { ...item, role: result.role } : item,
        ));
        this.roleChanges.update((changes) => {
          const updated = { ...changes };
          delete updated[result.memberId];
          return updated;
        });
        this.savingMemberId.set('');
        this.feedbackMessage.set(`Role updated for ${member.name}.`);
      },
      error: (error: HttpErrorResponse) => {
        this.savingMemberId.set('');
        this.errorMessage.set(error.status === 403
          ? 'Only administrators can change member roles.'
          : 'Unable to update this role. Please try again.');
      },
    });
  }

  private normalizedRole(role: string): MemberRole {
    return this.roles.find((option) => option.value === role.toLowerCase())?.value ?? 'member';
  }
}