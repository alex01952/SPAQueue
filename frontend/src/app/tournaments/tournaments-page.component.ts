import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [DatePipe, FormsModule],
  templateUrl: './tournaments-page.component.html',
  styleUrl: './tournaments-page.component.scss',
})
export class TournamentsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(MemberAuthService);
  private readonly apiUrl = getApiBaseUrl();
  private readonly destroyRef = inject(DestroyRef);
  private readonly partnerSearchTerms = new Subject<string>();

  protected readonly tournaments = signal<Tournament[]>([]);
  protected readonly registrations = signal<TournamentRegistration[]>([]);
  protected readonly tournamentLevels = tournamentLevels;
  protected readonly activeTournament = signal<Tournament | null>(null);
  protected readonly eligiblePartners = signal<TournamentPartnerSearchResult[]>([]);
  protected readonly selectedPartnerId = signal('');
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
    this.eligiblePartners.set([]);
    this.selectedPartnerId.set('');
    this.partnerSearchTerm.set('');
    this.partnerSearchTerms.next('');
    Object.assign(this.memberExperienceForm, emptyTournamentExperienceForm());
  }

  protected closeRegistration() {
    this.activeTournament.set(null);
    this.eligiblePartners.set([]);
    this.selectedPartnerId.set('');
    this.partnerSearchTerm.set('');
    this.partnerSearchTerms.next('');
    Object.assign(this.memberExperienceForm, emptyTournamentExperienceForm());
  }

  protected searchEligiblePartners(searchTerm: string) {
    this.partnerSearchTerm.set(searchTerm);
    this.selectedPartnerId.set('');
    this.errorMessage.set('');
    this.partnerSearchTerms.next(searchTerm.trim().toLocaleLowerCase());
  }

  protected register() {
    const tournament = this.activeTournament();
    if (
      !tournament ||
      !this.selectedPartnerId() ||
      !this.isExperienceFormComplete(this.memberExperienceForm) ||
      this.isWorking()
    ) return;
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(tournament.tournamentId)}/registrations`,
        {
          partnerId: this.selectedPartnerId(),
          memberExperience: this.toExperienceDetails(this.memberExperienceForm),
        },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.feedbackMessage.set('Invitation sent. Your registration will be reviewed after your partner accepts.');
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
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/respond`,
        {
          decision,
          ...(decision === 'Accepted'
            ? { partnerExperience: this.toExperienceDetails(this.partnerExperienceForm) }
            : {}),
        },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.feedbackMessage.set(decision === 'Accepted' ? 'Invitation accepted. The team is now pending admin approval.' : 'Invitation declined.');
          this.respondingInvitationId.set('');
          this.isWorking.set(false);
          this.loadPage();
        },
        error: (error: HttpErrorResponse) => {
          this.showError(error, 'Unable to respond to this invitation.');
          this.isWorking.set(false);
        },
      });
  }

  protected beginAccepting(registration: TournamentRegistration) {
    this.partnerExperienceForm = emptyTournamentExperienceForm();
    this.respondingInvitationId.set(registration.registrationId);
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

  protected uploadProof(registration: TournamentRegistration, file?: File) {
    if (!file || this.isWorking()) return;
    const formData = new FormData();
    formData.append('file', file);
    this.isWorking.set(true);
    this.errorMessage.set('');
    this.http
      .post<TournamentRegistration>(
        `${this.apiUrl}/tournaments/${encodeURIComponent(registration.tournamentId)}/registrations/${encodeURIComponent(registration.registrationId)}/payment-proof`,
        formData,
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.feedbackMessage.set('Payment proof uploaded.');
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
    return registration.status === 'Invitation Pending' && (
      registration.isIncomingInvitation === true ||
      registration.partnerId === this.auth.member()?.memberId
    );
  }

  protected isFull(tournament: Tournament): boolean {
    return tournament.registrationCount >= tournament.maxSlots;
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
}