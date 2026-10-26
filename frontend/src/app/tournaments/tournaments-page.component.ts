import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, finalize, of, Subject, switchMap, timer } from 'rxjs';
import { getApiBaseUrl } from '../api-base-url';
import { MemberAuthService } from '../member-auth.service';
import { tournamentLevels } from './tournament.types';
import type {
  Tournament,
  TournamentExperienceDetails,
  TournamentLevel,
  TournamentRegistration,
  TournamentPartnerSearchResult,
} from './tournament.types';

interface TournamentExperienceForm {
  hasJoinedTournaments: boolean | '';
  highestTournamentLevel: TournamentLevel | '';
  hasWonTournaments: boolean | '';
  highestWinningLevel: TournamentLevel | '';
  winsOrPodiums: number | null;
}

const emptyTournamentExperienceForm = (): TournamentExperienceForm => ({
  hasJoinedTournaments: '',
  highestTournamentLevel: '',
  hasWonTournaments: '',
  highestWinningLevel: '',
  winsOrPodiums: null,
});

@Component({
  selector: 'app-tournaments-page',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './tournaments-page.component.html',
  styleUrl: './tournaments-page.component.scss',
})
export class TournamentsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(MemberAuthService);
  protected readonly apiUrl = getApiBaseUrl();
  private readonly destroyRef = inject(DestroyRef);
  private readonly partnerSearchTerms = new Subject<string>();

  protected readonly tournaments = signal<Tournament[]>([]);
  protected readonly registrations = signal<TournamentRegistration[]>([]);
  protected readonly tournamentLevels = tournamentLevels;
  protected readonly activeTournament = signal<Tournament | null>(null);
  protected readonly eligiblePartners = signal<TournamentPartnerSearchResult[]>([]);
  protected readonly selectedPartnerId = signal('');
  protected readonly selectedTeamMembers = signal<TournamentPartnerSearchResult[]>([]);
  protected readonly partnerSearchTerm = signal('');
  protected readonly isSearchingPartners = signal(false);
  protected readonly respondingInvitationId = signal('');
  protected readonly memberExperienceForm = emptyTournamentExperienceForm();
  protected partnerExperienceForm = emptyTournamentExperienceForm();
  protected readonly isLoading = signal(true);
  protected readonly isLoadingRegistrations = signal(true);
  protected readonly isWorking = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly feedbackMessage = signal('');
  protected readonly paymentProofFiles = signal<Record<string, File>>({});
  protected memberTermsAccepted = false;
  protected partnerTermsAccepted = false;
  protected readonly memberIdFile = signal<File | null>(null);
  protected readonly partnerIdFile = signal<File | null>(null);
  protected memberClubDetails = '';
  protected partnerClubDetails = '';

  constructor() {
    this.partnerSearchTerms
      .pipe(
        distinctUntilChanged(),
        switchMap((searchTerm) => {
          this.eligiblePartners.set([]);
          if (searchTerm.length < 2) {
            this.isSearchingPartners.set(false);
            return of([]);
          }
          this.isSearchingPartners.set(true);
          return timer(250).pipe(
            switchMap(() => this.http.get<TournamentPartnerSearchResult[]>(
              `${this.apiUrl}/tournaments/${encodeURIComponent(this.activeTournament()?.tournamentId ?? '')}/eligible-partners`,
              { params: { search: searchTerm }, withCredentials: true },
            )),
            catchError((error: HttpErrorResponse) => {
              this.showError(error, 'Unable to search eligible partners.');
              return of([]);
            }),
            finalize(() => this.isSearchingPartners.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((partners) => this.eligiblePartners.set(partners));
  }

  ngOnInit() {
    this.loadPage();
  }

  protected openRegistration(tournament: Tournament) {
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.activeTournament.set(tournament);
    this.memberTermsAccepted = false;
    this.memberIdFile.set(null);
    this.memberClubDetails = '';
    this.eligiblePartners.set([]);
    this.selectedPartnerId.set('');
    this.selectedTeamMembers.set([]);
    this.partnerSearchTerm.set('');
    this.partnerSearchTerms.next('');
    Object.assign(this.memberExperienceForm, emptyTournamentExperienceForm());
  }

  protected closeRegistration() {
    this.activeTournament.set(null);
    this.memberTermsAccepted = false;
    this.memberIdFile.set(null);
    this.memberClubDetails = '';
    this.eligiblePartners.set([]);
    this.selectedPartnerId.set('');
    this.selectedTeamMembers.set([]);
    this.partnerSearchTerm.set('');
    this.partnerSearchTerms.next('');
    Object.assign(this.memberExperienceForm, emptyTournamentExperienceForm());
  }

  protected searchEligiblePartners(searchTerm: string) {
    this.partnerSearchTerm.set(searchTerm);
    if (!this.isTeamTournament()) this.selectedPartnerId.set('');
    this.errorMessage.set('');
    this.partnerSearchTerms.next(searchTerm.trim().toLocaleLowerCase());
  }

  protected register() {
    const tournament = this.activeTournament();
    if (
      !tournament ||
      (this.isTeamTournament() ? !this.isTeamRosterComplete() : !this.selectedPartnerId()) ||
      !this.isExperienceFormComplete(this.memberExperienceForm) ||
      this.isWorking()
    ) return;
    if (tournament.termsUrl && !this.memberTermsAccepted) {
      this.errorMessage.set('You must agree to the tournament terms and conditions before continuing.');
      return;
    }
    const idFile = this.memberIdFile();
    if (!idFile) {
      this.errorMessage.set('Upload your school, government, or company ID.');
      return;
    }
    const body = new FormData();
    body.append('idFile', idFile);
    body.append('clubDetails', this.memberClubDetails);
    body.append('partnerId', this.isTeamTournament()
      ? this.selectedTeamMembers()[0]!.memberId : this.selectedPartnerId());
    if (this.isTeamTournament()) {
      body.append('teamMemberIds', JSON.stringify(this.selectedTeamMembers().map((member) => member.memberId)));
    }
    body.append('memberExperience', JSON.stringify(this.toExperienceDetails(this.memberExperienceForm)));
    body.append('termsAccepted', JSON.stringify(this.memberTermsAccepted));
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(tournament.tournamentId)}/registrations`,
        body,
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.feedbackMessage.set(this.isTeamTournament()
            ? 'Invitations sent. The team will be reviewed after all three players accept.'
            : 'Invitation sent. Your registration will be reviewed after your partner accepts.');
          this.closeRegistration();
          this.isWorking.set(false);
          this.loadPage();
        },
        error: (error: HttpErrorResponse) => {
          this.showError(error, 'Unable to register this team.');
          this.isWorking.set(false);
        },
      });
  }

  protected respond(registration: TournamentRegistration, decision: 'Accepted' | 'Declined') {
    if (
      this.isWorking() ||
      (decision === 'Accepted' && !this.isExperienceFormComplete(this.partnerExperienceForm))
    ) return;
    if (decision === 'Accepted' && registration.termsUrl && !this.partnerTermsAccepted) {
      this.errorMessage.set('You must agree to the tournament terms and conditions before continuing.');
      return;
    }
    let body: FormData | { decision: 'Declined' };
    if (decision === 'Accepted') {
      const idFile = this.partnerIdFile();
      if (!idFile) {
        this.errorMessage.set('Upload your school, government, or company ID.');
        return;
      }
      body = new FormData();
      body.append('decision', decision);
      body.append('idFile', idFile);
      body.append('clubDetails', this.partnerClubDetails);
      body.append('partnerExperience', JSON.stringify(this.toExperienceDetails(this.partnerExperienceForm)));
      body.append('termsAccepted', JSON.stringify(this.partnerTermsAccepted));
    } else {
      body = { decision };
    }
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/respond`,
        body,
        { withCredentials: true },
      )
      .subscribe({
        next: (updatedRegistration) => {
          this.feedbackMessage.set(decision === 'Declined'
            ? 'Invitation declined.'
            : updatedRegistration.status === 'Pending Approval'
              ? 'All teammates accepted. The team is now pending admin approval.'
              : 'You accepted the invitation. The team is waiting for its other teammates.');
          this.respondingInvitationId.set('');
          this.partnerIdFile.set(null);
          this.partnerClubDetails = '';
          this.isWorking.set(false);
          this.loadPage();
        },
        error: (error: HttpErrorResponse) => {
          this.showError(error, 'Unable to respond to this invitation.');
          this.isWorking.set(false);
        },
      });
  }

  protected canCancelRegistration(registration: TournamentRegistration): boolean {
    return ['Invitation Pending', 'Pending Approval', 'Approved', 'Payment Submitted'].includes(registration.status);
  }

  protected cancelRegistration(registration: TournamentRegistration) {
    if (this.isWorking() || !this.canCancelRegistration(registration)) return;
    if (!window.confirm('Leaving this team will cancel the tournament registration for ALL members of the team. Everyone will need to register again to participate. Continue?')) return;
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http.delete<{ deleted: true }>(
      `${this.apiUrl}/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}`,
      { withCredentials: true },
    ).subscribe({
      next: () => {
        this.respondingInvitationId.set('');
        this.isWorking.set(false);
        this.loadPage();
        this.feedbackMessage.set('Tournament registration cancelled for all team members. Everyone can register again.');
      },
      error: (error: HttpErrorResponse) => {
        this.showError(error, error.status === 0
          ? 'Unable to reach the API to cancel this registration. Check your connection; if it persists, the server may be blocking the request (CORS). Refresh to check whether the registration was cancelled before retrying.'
          : 'Unable to cancel this tournament registration.');
        this.isWorking.set(false);
      },
    });
  }

  protected beginAccepting(registration: TournamentRegistration) {
    this.partnerTermsAccepted = false;
    this.partnerIdFile.set(null);
    this.partnerClubDetails = '';
    this.partnerExperienceForm = emptyTournamentExperienceForm();
    this.respondingInvitationId.set(registration.registrationId);
  }

  protected selectIdFile(input: HTMLInputElement, invitee = false) {
    const selected = invitee ? this.partnerIdFile : this.memberIdFile;
    selected.set(null);
    this.errorMessage.set('');
    const file = input.files?.[0];
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
      input.value = '';
      this.errorMessage.set('Player ID must be a PDF, JPEG, or PNG file no larger than 10 MB.');
      return;
    }
    selected.set(file);
  }

  protected isTeamTournament(): boolean {
    return this.activeTournament()?.category === 'Team Tournament';
  }

  protected isTeamMemberSelected(memberId: string): boolean {
    return this.selectedTeamMembers().some((member) => member.memberId === memberId);
  }

  protected canToggleTeamMember(candidate: TournamentPartnerSearchResult): boolean {
    if (this.isTeamMemberSelected(candidate.memberId)) return true;
    if (!candidate.eligible || this.selectedTeamMembers().length >= 3) return false;
    const group = this.genderGroup(candidate.gender);
    if (!group) return false;
    return this.teamRosterGenderCounts()[group] < 2;
  }

  protected teamMemberUnavailableReason(candidate: TournamentPartnerSearchResult): string | undefined {
    if (!candidate.eligible) return candidate.unavailableReason;
    if (this.isTeamMemberSelected(candidate.memberId)) return undefined;
    if (!this.genderGroup(candidate.gender)) return 'Team Tournament players must be men or women.';
    if (this.selectedTeamMembers().length >= 3) return 'Three teammates are already selected.';
    if (!this.canToggleTeamMember(candidate)) return 'The roster can include only two men and two women.';
    return undefined;
  }

  protected toggleTeamMember(candidate: TournamentPartnerSearchResult) {
    if (this.isTeamMemberSelected(candidate.memberId)) {
      this.selectedTeamMembers.update((members) => members.filter((member) => member.memberId !== candidate.memberId));
      return;
    }
    if (this.canToggleTeamMember(candidate)) {
      this.selectedTeamMembers.update((members) => [...members, candidate]);
    }
  }

  protected isTeamRosterComplete(): boolean {
    const counts = this.teamRosterGenderCounts();
    return this.selectedTeamMembers().length === 3 && counts.male === 2 && counts.female === 2;
  }

  protected teamRosterSummary(): string {
    if (!this.genderGroup(this.auth.member()?.gender ?? '')) {
      return 'Your profile gender must be Male or Female to form a two-men, two-women team.';
    }
    const counts = this.teamRosterGenderCounts();
    return `Selected ${this.selectedTeamMembers().length} of 3 teammates · ${counts.male}/2 men · ${counts.female}/2 women, including you.`;
  }

  protected teamMemberNames(registration: TournamentRegistration): string {
    return registration.teamMembers?.length
      ? registration.teamMembers.map((member) => member.name).join(' + ')
      : `${registration.memberName} + ${registration.partnerName}`;
  }

  protected memberRegistrationStatus(registration: TournamentRegistration): string {
    if (registration.status !== 'Invitation Pending') return registration.status;
    const currentMemberId = this.auth.member()?.memberId;
    const currentTeamMember = registration.teamMembers?.find((member) => member.memberId === currentMemberId);
    return registration.teamMembers?.length && currentTeamMember?.accepted
      ? 'Waiting for teammates'
      : registration.status;
  }

  protected isExperienceFormComplete(form: TournamentExperienceForm): boolean {
    if (typeof form.hasJoinedTournaments !== 'boolean' || typeof form.hasWonTournaments !== 'boolean') {
      return false;
    }
    if (form.hasJoinedTournaments && !form.highestTournamentLevel) return false;
    if (!form.hasJoinedTournaments && form.hasWonTournaments) return false;
    if (!form.hasWonTournaments) return true;
    return Boolean(
      form.highestWinningLevel &&
      typeof form.winsOrPodiums === 'number' &&
      Number.isInteger(form.winsOrPodiums) &&
      form.winsOrPodiums >= 1,
    );
  }

  protected toExperienceDetails(form: TournamentExperienceForm): TournamentExperienceDetails {
    const details: TournamentExperienceDetails = {
      hasJoinedTournaments: form.hasJoinedTournaments === true,
      hasWonTournaments: form.hasWonTournaments === true,
    };
    if (form.hasJoinedTournaments === true) {
      details.highestTournamentLevel = form.highestTournamentLevel as TournamentLevel;
    }
    if (form.hasWonTournaments === true) {
      details.highestWinningLevel = form.highestWinningLevel as TournamentLevel;
      details.winsOrPodiums = Number(form.winsOrPodiums);
    }
    return details;
  }

  protected canUploadProof(registration: TournamentRegistration): boolean {
    return registration.status === 'Approved' || registration.status === 'Payment Submitted';
  }

  protected selectedProofFile(registration: TournamentRegistration): File | undefined {
    return this.paymentProofFiles()[`${registration.tournamentId}:${registration.registrationId}`];
  }

  protected selectProofFile(registration: TournamentRegistration, file?: File) {
    const files = { ...this.paymentProofFiles() };
    const key = `${registration.tournamentId}:${registration.registrationId}`;
    delete files[key];
    this.errorMessage.set('');
    if (file) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
        this.errorMessage.set('Payment proof must be a PDF, JPEG, or PNG file no larger than 10 MB.');
      } else {
        files[key] = file;
      }
    }
    this.paymentProofFiles.set(files);
  }

  protected uploadProof(registration: TournamentRegistration) {
    if (this.isWorking() || !this.canUploadProof(registration)) return;
    const file = this.selectedProofFile(registration);
    if (!file) {
      this.errorMessage.set('Select a payment-proof file to upload.');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.feedbackMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/payment-proof`,
        formData,
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.selectProofFile(registration);
          this.feedbackMessage.set('Payment proof uploaded. An admin must confirm payment before the registration is marked paid.');
          this.isWorking.set(false);
          this.loadPage();
        },
        error: (error: HttpErrorResponse) => {
          this.showError(error, 'Unable to upload payment proof.');
          this.isWorking.set(false);
        },
      });
  }

  protected isIncomingInvitation(registration: TournamentRegistration): boolean {
    if (registration.status !== 'Invitation Pending') return false;
    const currentMemberId = this.auth.member()?.memberId;
    if (registration.teamMembers?.length) {
      return registration.teamMembers.some((member) =>
        member.memberId === currentMemberId && !member.accepted,
      );
    }
    return (
      registration.isIncomingInvitation === true ||
      registration.partnerId === currentMemberId
    );
  }

  protected isFull(tournament: Tournament): boolean {
    return tournament.registrationCount >= tournament.maxSlots;
  }

  protected isRegistrationClosed(tournamentId: string): boolean {
    return this.tournaments().some((tournament) => tournament.tournamentId === tournamentId && tournament.registrationClosed === true);
  }

  protected canViewRoster(registration: TournamentRegistration): boolean {
    return this.isRegistrationClosed(registration.tournamentId) &&
      ['Approved', 'Payment Submitted', 'Paid'].includes(registration.status);
  }

  protected slotPercentage(tournament: Tournament): number {
    return Math.min(100, (tournament.registrationCount / tournament.maxSlots) * 100);
  }

  private loadPage() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.http.get<Tournament[]>(`${this.apiUrl}/tournaments`, { withCredentials: true }).subscribe({
      next: (items) => {
        this.tournaments.set(items);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showError(error, 'Unable to load tournaments.');
        this.isLoading.set(false);
      },
    });
    this.isLoadingRegistrations.set(true);
    this.http
      .get<TournamentRegistration[]>(`${this.apiUrl}/members/me/tournament-registrations`, { withCredentials: true })
      .subscribe({
        next: (items) => {
          this.registrations.set(items);
          this.isLoadingRegistrations.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.showError(error, 'Unable to load your tournament registrations.');
          this.isLoadingRegistrations.set(false);
        },
      });
  }

  private showError(error: HttpErrorResponse, fallback: string) {
    this.errorMessage.set(error.error?.message ?? fallback);
  }

  private teamRosterGenderCounts(): { male: number; female: number } {
    const genders = [this.auth.member()?.gender ?? '', ...this.selectedTeamMembers().map((member) => member.gender)];
    return genders.reduce((counts, gender) => {
      const group = this.genderGroup(gender);
      if (group) counts[group] += 1;
      return counts;
    }, { male: 0, female: 0 });
  }

  private genderGroup(gender: string): 'male' | 'female' | null {
    const normalized = gender.trim().toLowerCase();
    if (normalized === 'male' || normalized === 'man') return 'male';
    if (normalized === 'female' || normalized === 'woman') return 'female';
    return null;
  }
}