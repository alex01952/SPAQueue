import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { MemberProfileFrameComponent } from '../member-profile/member-profile-frame.component';

interface MemberContact {
  memberId: string;
  name: string;
  reClubId: string;
  profileImageUrl: string;
  contactNo: string;
  email: string;
  emergencyContact: string;
}

@Component({
  selector: 'app-member-contacts-page',
  imports: [RouterLink, MemberProfileFrameComponent],
  templateUrl: './member-contacts-page.component.html',
  styleUrl: './member-contacts-page.component.scss',
})
export class MemberContactsPageComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;

  protected readonly searchText = signal('');
  protected readonly members = signal<MemberContact[]>([]);
  protected readonly selectedMembers = signal<Map<string, MemberContact>>(new Map());
  protected readonly selectedIds = computed(() => new Set(this.selectedMembers().keys()));
  protected readonly displayedMembers = computed(() => {
    const displayed = new Map(this.selectedMembers());
    for (const member of this.members()) displayed.set(member.memberId, member);
    return [...displayed.values()];
  });
  protected readonly profileMember = signal<MemberContact | null>(null);
  protected readonly loading = signal(false);
  protected readonly searched = signal(false);
  protected readonly error = signal('');
  protected readonly allSelected = computed(() =>
    this.displayedMembers().length > 0 && this.displayedMembers().every((member) => this.selectedIds().has(member.memberId)),
  );
  protected readonly someSelected = computed(() => this.selectedIds().size > 0 && !this.allSelected());

  protected search() {
    this.request?.unsubscribe();
    this.members.set([]);
    this.error.set('');
    this.searched.set(false);
    this.loading.set(false);
    const search = this.searchText().trim();
    if (!search) {
      this.error.set('Enter a member name or Reclub name.');
      return;
    }

    this.loading.set(true);
    this.request = this.http.get<MemberContact[]>(`${getApiBaseUrl()}/admin/member-contacts`, {
      params: { search },
      withCredentials: true,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (members) => {
        this.members.set(members);
        this.selectedMembers.update((selected) => {
          const updated = new Map(selected);
          for (const member of members) {
            if (updated.has(member.memberId)) updated.set(member.memberId, member);
          }
          return updated;
        });
        this.searched.set(true);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(error.status === 401
          ? 'Your session has expired. Sign in again.'
          : error.status === 403
            ? 'Only admins can view member contacts.'
            : 'Unable to search member contacts. Please try again.');
      },
    });
  }

  protected toggleMember(member: MemberContact, checked: boolean) {
    this.selectedMembers.update((selected) => {
      const next = new Map(selected);
      if (checked) next.set(member.memberId, member);
      else next.delete(member.memberId);
      return next;
    });
  }

  protected toggleAll(checked: boolean) {
    const displayed = this.displayedMembers();
    this.selectedMembers.update((selected) => {
      const next = new Map(selected);
      for (const member of displayed) {
        if (checked) next.set(member.memberId, member);
        else next.delete(member.memberId);
      }
      return next;
    });
  }

  protected exportCsv() {
    const members = [...this.selectedMembers().values()];
    if (!members.length) return;
    const rows = [
      ['Name', 'Reclub name', 'Contact number', 'Email', 'Emergency contact number'],
      ...members.map((member) => [member.name, member.reClubId, member.contactNo, member.email, member.emergencyContact]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv, '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'member-contacts.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  private csvCell(value: string) {
    const safeValue = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
}
