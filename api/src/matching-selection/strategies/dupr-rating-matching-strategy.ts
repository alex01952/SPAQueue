import { Team, Player } from '../../queue.types';
import { TeamMatchingStrategy } from '../matching-selection.types';

type TeamPairing = [Team, Team];

export class DuprRatingMatchingStrategy implements TeamMatchingStrategy {
	readonly name = 'dupr-balance';

	buildTeams({ players }: { players: Parameters<TeamMatchingStrategy['buildTeams']>[0]['players'] }) {
		if (players.length !== 4) {
			return [];
		}

		const pairings = buildPairings(players);

		return pairings.reduce((bestPairing, currentPairing) => {
			if (!bestPairing) {
				return currentPairing;
			}

			return comparePairings(currentPairing, bestPairing) < 0 ? currentPairing : bestPairing;
		}, null as TeamPairing | null) ?? [];
	}
}

function buildPairings(players: Player[]): TeamPairing[] {
	return [
		[
			createTeam('Team 1', [players[0], players[1]]),
			createTeam('Team 2', [players[2], players[3]]),
		],
		[
			createTeam('Team 1', [players[0], players[2]]),
			createTeam('Team 2', [players[1], players[3]]),
		],
		[
			createTeam('Team 1', [players[0], players[3]]),
			createTeam('Team 2', [players[1], players[2]]),
		],
	];
}

function createTeam(name: string, players: Player[]): Team {
	return {
		name,
		players,
	};
}

function comparePairings(left: TeamPairing, right: TeamPairing) {
	const differenceComparison = getRatingDifference(left) - getRatingDifference(right);

	if (differenceComparison !== 0) {
		return differenceComparison;
	}

	const strongerTeamComparison = getStrongerTeamRating(left) - getStrongerTeamRating(right);

	if (strongerTeamComparison !== 0) {
		return strongerTeamComparison;
	}

	return getPairingSignature(left).localeCompare(getPairingSignature(right));
}

function getRatingDifference(pairing: TeamPairing) {
	const [firstTeam, secondTeam] = pairing;

	return Math.abs(getTeamRating(firstTeam) - getTeamRating(secondTeam));
}

function getStrongerTeamRating(pairing: TeamPairing) {
	return Math.max(...pairing.map(getTeamRating));
}

function getTeamRating(team: Team) {
	return team.players.reduce((total, player) => total + (player.dupr ?? 3.0), 0);
}

function getPairingSignature(pairing: TeamPairing) {
	return pairing
		.map((team) => team.players.map((player) => player.id).sort((left, right) => left - right).join('-'))
		.sort()
		.join('|');
}
