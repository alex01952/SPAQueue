import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';

interface Recipient {
  memberId: string;
  name: string;
  email: string;
}
interface Club {
  clubId: string;
  name: string;
}
interface Preview {
  subject: string;
  html: string;
  text: string;
  recipientCount: number;
  fingerprint: string;
}
interface SendStatus {
  requestId: string;
  status: 'sending' | 'completed';
  total: number;
  accepted: number;
  unconfirmed: number;
}

@Component({
  selector: 'app-email-announcements-page',
  imports: [FormsModule],
  templateUrl: './email-announcements-page.component.html',
  styleUrl: './email-announcements-page.component.scss',
})
export class EmailAnnouncementsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly base = `${getApiBaseUrl()}/admin/email-announcements`;
  private readonly storageKey = 'spaqueue-announcement-request';
  protected readonly members = signal<Recipient[]>([]);
  protected readonly clubs = signal<Club[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly subject = signal('');
  protected readonly html = signal('<p>Hello members,</p>\n<p></p>');
  protected readonly mode = signal<'all' | 'club' | 'users'>('all');
  protected readonly clubId = signal('');
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly search = signal('');
  protected readonly preview = signal<Preview | null>(null);
  protected readonly status = signal<SendStatus | null>(null);
  protected readonly requestId = signal<string | null>(null);
  protected readonly locked = computed(() => this.busy() || !!this.requestId());
  protected readonly filteredMembers = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.members().filter((member) =>
      `${member.name} ${member.email}`.toLowerCase().includes(search),
    );
  });

  ngOnInit() {
    const savedId = sessionStorage.getItem(this.storageKey);
    if (savedId) {
      this.requestId.set(savedId);
      this.checkStatus();
    }
    this.loadRecipients();
  }

  protected loadRecipients() {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      members: this.http.get<Recipient[]>(`${this.base}/recipients`, { withCredentials: true }),
      clubs: this.http.get<Club[]>(`${getApiBaseUrl()}/clubs`, { withCredentials: true }),
    }).subscribe({
      next: ({ members, clubs }) => {
        this.members.set(members);
        this.clubs.set(clubs);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.apiError(error, 'Unable to load recipients.'));
      },
    });
  }

  protected invalidatePreview() {
    this.preview.set(null);
    this.error.set('');
  }

  protected toggleMember(id: string, checked: boolean) {
    if (this.locked()) return;
    this.selectedIds.update((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
    this.invalidatePreview();
  }

  protected format(editor: HTMLTextAreaElement, before: string, after: string) {
    if (this.locked()) return;
    const start = editor.selectionStart;
    const selected = editor.value.slice(start, editor.selectionEnd) || 'Your text';
    editor.setRangeText(`${before}${selected}${after}`, start, editor.selectionEnd, 'select');
    this.html.set(editor.value);
    this.invalidatePreview();
    editor.focus();
  }

  private payload() {
    return {
      subject: this.subject(),
      html: this.html(),
      audience: {
        mode: this.mode(),
        ...(this.mode() === 'club' ? { clubId: this.clubId() } : {}),
        ...(this.mode() === 'users' ? { memberIds: this.selectedIds() } : {}),
      },
    };
  }

  protected buildPreview() {
    if (this.locked() || this.loading()) return;
    if (
      !this.subject().trim() ||
      !this.html().trim() ||
      (this.mode() === 'club' && !this.clubId()) ||
      (this.mode() === 'users' && !this.selectedIds().length)
    ) {
      this.error.set('Enter a subject and message, and select the audience.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.preview.set(null);
    this.http
      .post<Preview>(`${this.base}/preview`, this.payload(), { withCredentials: true })
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.busy.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(this.apiError(error, 'Unable to preview the announcement.'));
        },
      });
  }

  protected send() {
    const preview = this.preview();
    if (!preview || this.locked()) return;
    if (
      !window.confirm(
        `Send "${preview.subject}" to ${preview.recipientCount} recipients? This uses ${preview.recipientCount} Mailgun emails and cannot be undone.`,
      )
    )
      return;
    const requestId = crypto.randomUUID();
    // Persist before sending so a lost HTTP response or reload cannot trigger a duplicate.
    sessionStorage.setItem(this.storageKey, requestId);
    this.requestId.set(requestId);
    this.busy.set(true);
    this.error.set('');
    this.http
      .post<SendStatus>(
        `${this.base}/send`,
        {
          ...this.payload(),
          requestId,
          fingerprint: preview.fingerprint,
        },
        { withCredentials: true },
      )
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.busy.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.busy.set(false);
          if (error.status === 409 && error.error?.code === 'ANNOUNCEMENT_PREVIEW_CHANGED') {
            sessionStorage.removeItem(this.storageKey);
            this.requestId.set(null);
            this.preview.set(null);
            this.error.set(this.apiError(error, 'Recipients changed. Preview and confirm again.'));
            return;
          }
          this.error.set(
            `${this.apiError(error, 'The send request was interrupted.')} Check send status before taking further action. Do not resend automatically.`,
          );
        },
      });
  }

  protected checkStatus() {
    const id = this.requestId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    this.http.get<SendStatus>(`${this.base}/${id}`, { withCredentials: true }).subscribe({
      next: (status) => {
        this.status.set(status);
        this.busy.set(false);
        this.error.set('');
      },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(
          this.apiError(error, 'Unable to check send status. Do not resend automatically.'),
        );
      },
    });
  }

  protected newAnnouncement() {
    if (this.busy()) return;
    if (
      this.requestId() &&
      !window.confirm(
        'Start a new announcement? This does not cancel the previous send. Resending the same message may create duplicate emails.',
      )
    )
      return;
    sessionStorage.removeItem(this.storageKey);
    this.requestId.set(null);
    this.status.set(null);
    this.preview.set(null);
    this.subject.set('');
    this.html.set('<p>Hello members,</p>\n<p></p>');
    this.selectedIds.set([]);
    this.mode.set('all');
    this.clubId.set('');
    this.error.set('');
  }

  private apiError(error: HttpErrorResponse, fallback: string): string {
    const message: unknown = error.error?.message;
    return typeof message === 'string' ? message : fallback;
  }
}
