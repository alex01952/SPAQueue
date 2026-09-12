import { Component, ElementRef, computed, signal, viewChild } from '@angular/core';

interface TeamMatchingPlayer {
  id: number;
  name: string;
  duprRating: string;
}

interface MatchedTeam {
  name: string;
  playerOne: TeamMatchingPlayer;
  playerTwo: TeamMatchingPlayer;
}

interface DirectTeamEntry {
  id: number;
  name: string;
  playerOneName: string;
  playerTwoName: string;
}

interface TeamPool {
  number: number;
  teams: MatchedTeam[];
}

interface ScheduledMatch {
  courtNumber: number;
  poolNumber: number;
  teamOne: MatchedTeam;
  teamTwo: MatchedTeam;
}

interface ScheduleSlot {
  number: number;
  matches: ScheduledMatch[];
}

@Component({
  selector: 'app-team-matching-page',
  imports: [],
  templateUrl: './team-matching-page.component.html',
  styleUrl: './team-matching-page.component.scss',
})
export class TeamMatchingPageComponent {
  private nextPlayerId = 5;
  private nextDirectTeamId = 3;
  private availableTeamNames: string[] = [];
  private matchingTimer: ReturnType<typeof setTimeout> | undefined;
  private poolAnimationTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly players = signal<TeamMatchingPlayer[]>([
    { id: 1, name: '', duprRating: '' },
    { id: 2, name: '', duprRating: '' },
    { id: 3, name: '', duprRating: '' },
    { id: 4, name: '', duprRating: '' },
  ]);
  protected readonly rosterText = signal('');
  protected readonly rosterImportError = signal('');
  protected readonly isDirectTeamEntry = signal(false);
  protected readonly directTeamsText = signal('');
  protected readonly directTeamImportError = signal('');
  protected readonly directTeamEntries = signal<DirectTeamEntry[]>([
    { id: 1, name: '', playerOneName: '', playerTwoName: '' },
    { id: 2, name: '', playerOneName: '', playerTwoName: '' },
  ]);
  protected readonly teamNamesText = signal('');
  protected readonly buffer = signal('0');
  protected readonly teams = signal<MatchedTeam[]>([]);
  protected readonly poolCount = signal('2');
  protected readonly pools = signal<TeamPool[]>([]);
  protected readonly isRandomizingPools = signal(false);
  protected readonly courtCount = signal('2');
  protected readonly schedule = signal<ScheduleSlot[]>([]);
  protected readonly remainingPlayers = signal<TeamMatchingPlayer[]>([]);
  protected readonly activePlayer = signal<TeamMatchingPlayer | null>(null);
  protected readonly eligiblePartners = signal<TeamMatchingPlayer[]>([]);
  protected readonly highlightedPartnerId = signal<number | null>(null);
  protected readonly validationMessage = signal('');
  protected readonly matchingError = signal('');
  protected readonly isRandomizing = signal(false);
  private readonly matchingResults = viewChild<ElementRef<HTMLElement>>('matchingResults');
  protected readonly averageDuprRating = computed(() => {
    const validRatings = this.players().map((player) => this.getDuprRating(player));

    if (!validRatings.length || validRatings.some((rating) => rating === null)) {
      return null;
    }

    const ratings = validRatings as number[];
    return ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
  });
  protected readonly partnerRatingAllowance = computed(() => {
    const average = this.averageDuprRating();
    const buffer = this.getBufferValue();

    return average === null || buffer === null ? null : average + buffer;
  });
  protected readonly validationError = computed(() => this.getValidationMessage());
  protected readonly canRandomize = computed(
    () => !this.isRandomizing() && !this.validationError(),
  );
  protected readonly isMatchingComplete = computed(
    () => this.teams().length > 0 && !this.isRandomizing(),
  );
  protected readonly directTeamValidationError = computed(() => {
    const entries = this.directTeamEntries();

    if (!entries.length) {
      return 'Add at least one team before continuing.';
    }

    if (
      entries.some(
        (entry) =>
          !entry.name.trim() || !entry.playerOneName.trim() || !entry.playerTwoName.trim(),
      )
    ) {
      return 'Enter a team name and two players for every team.';
    }

    return '';
  });
  private readonly poolResults = viewChild<ElementRef<HTMLElement>>('poolResults');
  private readonly scheduleResults = viewChild<ElementRef<HTMLElement>>('scheduleResults');
  protected readonly poolValidationError = computed(() => {
    if (!this.isMatchingComplete()) {
      return '';
    }

    const poolCount = this.getPoolCount();
    if (poolCount === null || poolCount > this.teams().length) {
      return `Enter a whole number from 1 to ${this.teams().length} for the number of pools.`;
    }

    return '';
  });

  protected addPlayer() {
    this.resetMatching();
    this.players.update((players) => [
      ...players,
      { id: this.nextPlayerId++, name: '', duprRating: '' },
    ]);
  }

  protected updateRosterText(rosterText: string) {
    this.rosterText.set(rosterText);
    this.rosterImportError.set('');
  }

  protected importRoster() {
    const lines = this.rosterText()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      this.rosterImportError.set('Paste at least one player in the format Name,DUPR rating.');
      return;
    }

    const importedPlayers: TeamMatchingPlayer[] = [];
    for (const [index, line] of lines.entries()) {
      const values = line.split(',').map((value) => value.trim());
      const [name, duprRating] = values;

      if (values.length !== 2 || !name || this.getDuprRating({ id: 0, name, duprRating }) === null) {
        this.rosterImportError.set(
          `Line ${index + 1} must include a player name and a DUPR rating from 1.00 to 8.00.`,
        );
        return;
      }

      importedPlayers.push({ id: this.nextPlayerId++, name, duprRating });
    }

    this.resetMatching();
    this.players.set(importedPlayers);
    this.rosterText.set('');
    this.rosterImportError.set('');
  }

  protected startDirectTeamEntry() {
    this.resetMatching();
    this.isDirectTeamEntry.set(true);
  }

  protected returnToPlayerMatching() {
    this.resetMatching();
    this.isDirectTeamEntry.set(false);
  }

  protected updateDirectTeamsText(directTeamsText: string) {
    this.directTeamsText.set(directTeamsText);
    this.directTeamImportError.set('');
  }

  protected importDirectTeams() {
    const lines = this.directTeamsText()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const dataLines =
      lines[0]?.toLowerCase() === 'team name,first player,second player'
        ? lines.slice(1)
        : lines;

    if (!dataLines.length) {
      this.directTeamImportError.set(
        'Paste at least one team in the format Team Name,First Player,Second Player.',
      );
      return;
    }

    const importedTeams: DirectTeamEntry[] = [];
    for (const [index, line] of dataLines.entries()) {
      const values = line.split(',').map((value) => value.trim());
      const [name, playerOneName, playerTwoName] = values;

      if (values.length !== 3 || !name || !playerOneName || !playerTwoName) {
        this.directTeamImportError.set(
          `Line ${index + 1} must include a team name, first player, and second player.`,
        );
        return;
      }

      importedTeams.push({
        id: this.nextDirectTeamId++,
        name,
        playerOneName,
        playerTwoName,
      });
    }

    this.resetMatching();
    this.directTeamEntries.set(importedTeams);
    this.directTeamsText.set('');
    this.directTeamImportError.set('');
    this.useDirectTeams();
  }

  protected addDirectTeam() {
    this.resetMatching();
    this.directTeamEntries.update((entries) => [
      ...entries,
      {
        id: this.nextDirectTeamId++,
        name: '',
        playerOneName: '',
        playerTwoName: '',
      },
    ]);
  }

  protected updateDirectTeam(id: number, changes: Partial<DirectTeamEntry>) {
    this.resetMatching();
    this.directTeamEntries.update((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    );
  }

  protected removeDirectTeam(id: number) {
    this.resetMatching();
    this.directTeamEntries.update((entries) => entries.filter((entry) => entry.id !== id));
  }

  protected useDirectTeams() {
    if (this.directTeamValidationError()) {
      return;
    }

    this.resetMatching();
    this.teams.set(
      this.directTeamEntries().map((entry) => ({
        name: entry.name.trim(),
        playerOne: {
          id: entry.id * 2 - 1,
          name: entry.playerOneName.trim(),
          duprRating: '',
        },
        playerTwo: {
          id: entry.id * 2,
          name: entry.playerTwoName.trim(),
          duprRating: '',
        },
      })),
    );
    requestAnimationFrame(() => {
      this.poolResults()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected updatePlayerName(id: number, name: string) {
    this.resetMatching();
    this.updatePlayer(id, { name });
  }

  protected updatePlayerDuprRating(id: number, duprRating: string) {
    this.resetMatching();
    this.updatePlayer(id, { duprRating });
  }

  protected updateTeamNames(teamNamesText: string) {
    this.resetMatching();
    this.teamNamesText.set(teamNamesText);
  }

  protected removePlayer(id: number) {
    this.resetMatching();
    this.players.update((players) => players.filter((player) => player.id !== id));
  }

  protected updateBuffer(buffer: string) {
    this.resetMatching();
    this.buffer.set(buffer);
  }

  protected updatePoolCount(poolCount: string) {
    this.clearPoolAnimationTimer();
    this.poolCount.set(poolCount);
    this.pools.set([]);
    this.schedule.set([]);
    this.isRandomizingPools.set(false);
  }

  protected randomizePools() {
    const poolCount = this.getPoolCount();

    if (poolCount === null || this.poolValidationError()) {
      return;
    }

    this.clearPoolAnimationTimer();
    const shuffledTeams = this.shuffle([...this.teams()]);
    const pools = Array.from({ length: poolCount }, (_, index) => ({
      number: index + 1,
      teams: [] as MatchedTeam[],
    }));

    shuffledTeams.forEach((team, index) => pools[index % poolCount].teams.push(team));
    this.pools.set(pools);
    this.schedule.set([]);
    this.isRandomizingPools.set(true);
    requestAnimationFrame(() => {
      this.poolResults()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    this.poolAnimationTimer = setTimeout(() => this.isRandomizingPools.set(false), 900);
  }

  protected updateCourtCount(courtCount: string) {
    this.courtCount.set(courtCount);
    this.schedule.set([]);
  }

  protected generateSchedule() {
    const courtCount = this.getCourtCount();

    if (courtCount === null || this.scheduleValidationError()) {
      return;
    }

    this.schedule.set(this.createSchedule(courtCount));
    requestAnimationFrame(() => {
      this.scheduleResults()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected randomizeTeams() {
    const validationMessage = this.validationError();
    this.validationMessage.set(validationMessage);

    if (validationMessage) {
      return;
    }

    this.clearMatchingTimer();
    const teamNames = this.getTeamNames();
    this.teams.set([]);
    this.remainingPlayers.set([...this.players()]);
    this.activePlayer.set(null);
    this.eligiblePartners.set([]);
    this.highlightedPartnerId.set(null);
    this.matchingError.set('');
    this.availableTeamNames = [...teamNames];
    this.isRandomizing.set(true);
    this.matchNextTeam();
    requestAnimationFrame(() => {
      this.matchingResults()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected formatRating(rating: number | null) {
    return rating === null ? '--' : rating.toFixed(2);
  }

  protected formatPlayerRating(player: TeamMatchingPlayer) {
    return this.formatRating(this.getDuprRating(player));
  }

  protected getTeamCombinedRating(team: MatchedTeam) {
    return (this.getDuprRating(team.playerOne) ?? 0) + (this.getDuprRating(team.playerTwo) ?? 0);
  }

  protected getMaximumCombinedDupr(player: TeamMatchingPlayer) {
    const playerRating = this.getDuprRating(player);
    const partnerRatingAllowance = this.partnerRatingAllowance();

    return playerRating === null || partnerRatingAllowance === null
      ? null
      : playerRating + partnerRatingAllowance;
  }

  protected getMatchLabel(match: ScheduledMatch) {
    return `${match.teamOne.name} vs ${match.teamTwo.name}`;
  }

  private matchNextTeam() {
    const remainingPlayers = this.remainingPlayers();

    if (!remainingPlayers.length) {
      this.activePlayer.set(null);
      this.eligiblePartners.set([]);
      this.highlightedPartnerId.set(null);
      this.isRandomizing.set(false);
      return;
    }

    const activePlayerIndex = Math.floor(Math.random() * remainingPlayers.length);
    const activePlayer = remainingPlayers[activePlayerIndex];
    const maximumCombinedDupr = this.getMaximumCombinedDupr(activePlayer) ?? 0;
    const activePlayerRating = this.getDuprRating(activePlayer) ?? 0;
    const eligiblePartners = remainingPlayers.filter(
      (player) =>
        player.id !== activePlayer.id &&
        activePlayerRating + (this.getDuprRating(player) ?? 0) <= maximumCombinedDupr,
    );
    const fallbackPartner = this.getBestBalancingPartner(activePlayer, remainingPlayers);
    const partnerCandidates = eligiblePartners.length ? eligiblePartners : [fallbackPartner];

    this.activePlayer.set(activePlayer);
    this.eligiblePartners.set(partnerCandidates);

    let animationStep = 0;
    this.highlightedPartnerId.set(partnerCandidates[0].id);
    const animation = () => {
      this.highlightedPartnerId.set(partnerCandidates[animationStep % partnerCandidates.length].id);
      animationStep += 1;

      if (animationStep < 10) {
        this.matchingTimer = setTimeout(animation, 110);
        return;
      }

      const selectedPartner = partnerCandidates[Math.floor(Math.random() * partnerCandidates.length)];
      this.highlightedPartnerId.set(selectedPartner.id);
      this.teams.update((teams) => [
        ...teams,
        {
          name: this.drawTeamName(),
          playerOne: activePlayer,
          playerTwo: selectedPartner,
        },
      ]);
      this.remainingPlayers.set(
        remainingPlayers.filter(
          (player) => player.id !== activePlayer.id && player.id !== selectedPartner.id,
        ),
      );
      this.matchingTimer = setTimeout(() => this.matchNextTeam(), 700);
    };

    this.matchingTimer = setTimeout(animation, 110);
  }

  private getValidationMessage() {
    const players = this.players();

    if (players.length < 2 || players.length % 2 !== 0) {
      return 'Add an even number of players so everyone can be placed on a two-player team.';
    }

    if (players.some((player) => !player.name.trim())) {
      return 'Enter a name for every player before randomizing.';
    }

    if (players.some((player) => this.getDuprRating(player) === null)) {
      return 'Enter a DUPR rating from 1.00 to 8.00 for every player.';
    }

    if (this.getBufferValue() === null) {
      return 'Enter a buffer value of zero or greater.';
    }

    const teamNames = this.getTeamNames();
    const expectedTeamCount = players.length / 2;
    if (teamNames.length < expectedTeamCount) {
      return `Enter at least ${expectedTeamCount} team names, one per line.`;
    }

    return '';
  }

  private getTeamNames() {
    return this.teamNamesText()
      .split(/\r?\n/)
      .map((teamName) => teamName.trim())
      .filter(Boolean);
  }

  private drawTeamName() {
    const teamNameIndex = Math.floor(Math.random() * this.availableTeamNames.length);
    return this.availableTeamNames.splice(teamNameIndex, 1)[0];
  }

  private getBestBalancingPartner(
    activePlayer: TeamMatchingPlayer,
    remainingPlayers: TeamMatchingPlayer[],
  ) {
    const availablePartners = remainingPlayers.filter((player) => player.id !== activePlayer.id);
    const remainingAverage =
      remainingPlayers.reduce((total, player) => total + (this.getDuprRating(player) ?? 0), 0) /
      remainingPlayers.length;
    const complementaryRating = remainingAverage * 2 - (this.getDuprRating(activePlayer) ?? 0);

    return availablePartners.reduce((bestPartner, player) => {
      const playerDistance = Math.abs((this.getDuprRating(player) ?? 0) - complementaryRating);
      const bestPartnerDistance = Math.abs(
        (this.getDuprRating(bestPartner) ?? 0) - complementaryRating,
      );

      return playerDistance < bestPartnerDistance ? player : bestPartner;
    });
  }

  private getDuprRating(player: TeamMatchingPlayer) {
    const rating = Number(player.duprRating);

    return Number.isFinite(rating) && rating >= 1 && rating <= 8 ? rating : null;
  }

  private getPoolCount() {
    const poolCount = Number(this.poolCount());

    return Number.isInteger(poolCount) && poolCount >= 1 ? poolCount : null;
  }

  protected readonly scheduleValidationError = computed(() => {
    if (!this.pools().length) {
      return '';
    }

    if (this.getCourtCount() === null) {
      return 'Enter a whole number of courts greater than zero.';
    }

    if (this.pools().some((pool) => pool.teams.length < 2)) {
      return 'Each pool needs at least two teams to create a round-robin schedule.';
    }

    return '';
  });

  private getCourtCount() {
    const courtCount = Number(this.courtCount());

    return Number.isInteger(courtCount) && courtCount >= 1 ? courtCount : null;
  }

  private createSchedule(courtCount: number) {
    const pools = this.pools();
    const hasDedicatedPoolCourts =
      pools.length === courtCount && pools.every((pool) => pool.teams.length === pools[0].teams.length);
    const remainingMatches = pools.flatMap((pool) => this.createPoolMatches(pool));
    const schedule: ScheduleSlot[] = [];
    let previousSlotTeams = new Set<MatchedTeam>();

    while (remainingMatches.length) {
      const usedTeams = new Set<MatchedTeam>();
      const slotMatches: ScheduledMatch[] = [];

      if (hasDedicatedPoolCourts) {
        for (const pool of pools) {
          const matchIndex = this.findBestMatchIndex(
            remainingMatches,
            usedTeams,
            previousSlotTeams,
            pool.number,
          );
          if (matchIndex !== -1) {
            const match = remainingMatches.splice(matchIndex, 1)[0];
            slotMatches.push({ ...match, courtNumber: pool.number });
            usedTeams.add(match.teamOne);
            usedTeams.add(match.teamTwo);
          }
        }
      } else {
        while (slotMatches.length < courtCount) {
          const matchIndex = this.findBestMatchIndex(
            remainingMatches,
            usedTeams,
            previousSlotTeams,
          );
          if (matchIndex === -1) {
            break;
          }

          const match = remainingMatches.splice(matchIndex, 1)[0];
          slotMatches.push({ ...match, courtNumber: slotMatches.length + 1 });
          usedTeams.add(match.teamOne);
          usedTeams.add(match.teamTwo);
        }
      }

      schedule.push({ number: schedule.length + 1, matches: slotMatches });
      previousSlotTeams = usedTeams;
    }

    return schedule;
  }

  private createPoolMatches(pool: TeamPool) {
    const matches: Omit<ScheduledMatch, 'courtNumber'>[] = [];

    for (let firstIndex = 0; firstIndex < pool.teams.length - 1; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < pool.teams.length; secondIndex += 1) {
        matches.push({
          poolNumber: pool.number,
          teamOne: pool.teams[firstIndex],
          teamTwo: pool.teams[secondIndex],
        });
      }
    }

    return this.shuffle(matches);
  }

  private findBestMatchIndex(
    matches: Omit<ScheduledMatch, 'courtNumber'>[],
    usedTeams: Set<MatchedTeam>,
    previousSlotTeams: Set<MatchedTeam>,
    poolNumber?: number,
  ) {
    const candidates = matches
      .map((match, index) => ({ match, index }))
      .filter(
        ({ match }) =>
          (poolNumber === undefined || match.poolNumber === poolNumber) &&
          !usedTeams.has(match.teamOne) &&
          !usedTeams.has(match.teamTwo),
      );

    if (!candidates.length) {
      return -1;
    }

    const restedCandidate = candidates.find(
      ({ match }) =>
        !previousSlotTeams.has(match.teamOne) && !previousSlotTeams.has(match.teamTwo),
    );

    return (restedCandidate ?? candidates[0]).index;
  }

  private shuffle<T>(items: T[]) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
    }

    return items;
  }

  private getBufferValue() {
    const buffer = Number(this.buffer());

    return Number.isFinite(buffer) && buffer >= 0 ? buffer : null;
  }

  private resetMatching() {
    this.clearMatchingTimer();
    this.clearPoolAnimationTimer();
    this.availableTeamNames = [];
    this.teams.set([]);
    this.pools.set([]);
    this.schedule.set([]);
    this.isRandomizingPools.set(false);
    this.remainingPlayers.set([]);
    this.activePlayer.set(null);
    this.eligiblePartners.set([]);
    this.highlightedPartnerId.set(null);
    this.validationMessage.set('');
    this.matchingError.set('');
    this.isRandomizing.set(false);
  }

  private clearMatchingTimer() {
    if (this.matchingTimer) {
      clearTimeout(this.matchingTimer);
      this.matchingTimer = undefined;
    }
  }

  private clearPoolAnimationTimer() {
    if (this.poolAnimationTimer) {
      clearTimeout(this.poolAnimationTimer);
      this.poolAnimationTimer = undefined;
    }
  }

  private updatePlayer(id: number, changes: Partial<TeamMatchingPlayer>) {
    this.players.update((players) =>
      players.map((player) => (player.id === id ? { ...player, ...changes } : player)),
    );
  }
}