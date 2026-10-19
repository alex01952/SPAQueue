import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getApiBaseUrl } from '../api-base-url';
import {
  tournamentProtestCategories,
  type TournamentProtest,
  type TournamentProtestCategory,
  type TournamentRoster,
  type TournamentRosterPlayer,
  type TournamentRosterTeam,
} from './tournament.types';

export const PROTEST_EVIDENCE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const PROTEST_EVIDENCE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MIN_PROTEST_REASON_LENGTH = 20;
export const MAX_PROTEST_REASON_LENGTH = 2000;

@Component({
  selector: 'app-tournament-roster-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './tournament-roster-page.component.html',
  styleUrl: './tournament-roster-page.component.scss',
})
export class TournamentRosterPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly apiUrl = getApiBaseUrl();

  protected readonly categories = tournamentProtestCategories;
  protected readonly minReasonLength = MIN_PROTEST_REASON_LENGTH;
  protected readonly maxReasonLength = MAX_PROTEST_REASON_LENGTH;
  protected readonly evidenceAccept = PROTEST_EVIDENCE_EXTENSIONS.join(',');
  protected readonly roster = signal<TournamentRoster | null>(null);
  protected readonly protests = signal<TournamentProtest[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly protestTarget = signal<TournamentRosterPlayer | null>(null);
  protected readonly evidenceFiles = signal<File[]>([]);
  protected readonly evidenceError = signal('');
  protected protestForm: { eligibilityCategory: TournamentProtestCategory | ''; reason: string } = {
    eligibilityCategory: '',
    reason: '',
  };

  private tournamentId = '';

  ngOnInit() {
    this.tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.loadData();
  }

  protected beginProtest(player: TournamentRosterPlayer) {
    this.protestTarget.set(player);
    this.protestForm = { eligibilityCategory: '', reason: '' };
    this.evidenceFiles.set([]);
    this.evidenceError.set('');
    this.errorMessage.set('');
    this.feedbackMessage.set('');
  }

  protected cancelProtest() {
    this.protestTarget.set(null);
    this.evidenceFiles.set([]);
    this.evidenceError.set('');
  }

  protected selectEvidence(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    this.evidenceFiles.set([]);
    this.evidenceError.set('');
    if (!files.length) return;
    if (files.length > MAX_EVIDENCE_FILES) {
      input.value = '';
      this.evidenceError.set(`Attach no more than ${MAX_EVIDENCE_FILES} evidence files.`);
      return;
    }
    const invalid = files.find((file) => !this.isAllowedEvidence(file));
    if (invalid) {
      input.value = '';
      this.evidenceError.set(`${invalid.name} is not allowed. Evidence must be a PDF, JPEG, PNG, DOC, or DOCX file no larger than 10 MB.`);
      return;
    }
    this.evidenceFiles.set(files);
  }

  protected reasonLength(): number {
    return this.protestForm.reason.trim().length;
  }

  protected canSubmitProtest(): boolean {
    const length = this.reasonLength();
    return (
      !!this.protestTarget() &&
      !!this.protestForm.eligibilityCategory &&
      length >= MIN_PROTEST_REASON_LENGTH &&
      length <= MAX_PROTEST_REASON_LENGTH &&
      this.evidenceFiles().length > 0 &&
      !this.isSubmitting()
    );
  }

  protected submitProtest(evidenceInput: HTMLInputElement) {
    const target = this.protestTarget();
    if (!target || !this.canSubmitProtest()) {
      if (!this.evidenceFiles().length) this.evidenceError.set('Evidence is required. Attach at least one image or document.');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    const body = new FormData();
    body.append('protestedMemberId', target.memberId);
    body.append('eligibilityCategory', this.protestForm.eligibilityCategory);
    body.append('reason', this.protestForm.reason.trim());
    this.evidenceFiles().forEach((file) => body.append('evidence', file, file.name));
    this.http.post<TournamentProtest>(
      `${this.apiUrl}/tournaments/${encodeURIComponent(this.tournamentId)}/protests`,
      body,
      { withCredentials: true },
    ).subscribe({
      next: (protest) => {
        this.protests.update((items) => [protest, ...items]);
        this.feedbackMessage.set(`Your protest against ${target.name} was submitted for admin review.`);
        evidenceInput.value = '';
        this.cancelProtest();
        this.isSubmitting.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to submit this protest.'));
        this.isSubmitting.set(false);
      },
    });
  }

  protected canProtest(team: TournamentRosterTeam): boolean {
    return !team.isOwnTeam && this.ownTeamListed();
  }

  protected hasOpenProtest(memberId: string): boolean {
    return this.protests().some((protest) => protest.protestedMemberId === memberId && protest.status === 'Open');
  }

  protected formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  private ownTeamListed(): boolean {
    return this.roster()?.teams.some((team) => team.isOwnTeam) ?? false;
  }

  private isAllowedEvidence(file: File): boolean {
    const name = file.name.toLowerCase();
    const extensionAllowed = PROTEST_EVIDENCE_EXTENSIONS.some((extension) => name.endsWith(extension));
    const typeAllowed = !file.type || PROTEST_EVIDENCE_TYPES.includes(file.type);
    return extensionAllowed && typeAllowed && file.size > 0 && file.size <= MAX_EVIDENCE_BYTES;
  }

  private loadData() {
    const id = encodeURIComponent(this.tournamentId);
    this.isLoading.set(true);
    this.http.get<TournamentRoster>(`${this.apiUrl}/tournaments/${id}/roster`, { withCredentials: true }).subscribe({
      next: (roster) => {
        this.roster.set(roster);
        this.isLoading.set(false);
        if (roster.teams.some((team) => team.isOwnTeam)) this.loadProtests();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(this.errorText(error, 'Unable to load the tournament roster.'));
        this.isLoading.set(false);
      },
    });
  }

  private loadProtests() {
    this.http.get<TournamentProtest[]>(
      `${this.apiUrl}/tournaments/${encodeURIComponent(this.tournamentId)}/protests/mine`,
      { withCredentials: true },
    ).subscribe({
      next: (items) => this.protests.set(items),
      error: (error: HttpErrorResponse) => this.errorMessage.set(this.errorText(error, 'Unable to load your protests.')),
    });
  }

  private errorText(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) return 'Unable to reach the API. Check your connection and try again.';
    const message = error.error?.message;
    return Array.isArray(message) ? message.join(' ') : (message ?? fallback);
  }
}
