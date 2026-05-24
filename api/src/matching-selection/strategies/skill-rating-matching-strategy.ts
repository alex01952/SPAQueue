import { Player, SkillLevel, Team } from '../../queue.types';
import { TeamMatchingStrategy } from '../matching-selection.types';

type TeamPairing = [Team, Team];

const skillLevelRatings: Record<SkillLevel, number> = {
	Beginner: 1,
	Novice: 2,
	Intermediate: 3,
	'High Intermediate': 4,
	Advanced: 5,
};

export class SkillRatingMatchingStrategy implements TeamMatchingStrategy {
	readonly name = 'skill-balance';

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
	return { name, players };
}

function comparePairings(left: TeamPairing, right: TeamPairing) {
	const skillDifferenceComparison = getSkillDifference(left) - getSkillDifference(right);

	if (skillDifferenceComparison !== 0) {
		return skillDifferenceComparison;
	}

	const strongerSkillTeamComparison = getStrongerSkillTeamRating(left) - getStrongerSkillTeamRating(right);

	if (strongerSkillTeamComparison !== 0) {
		return strongerSkillTeamComparison;
	}

	const duprDifferenceComparison = getDuprDifference(left) - getDuprDifference(right);

	if (duprDifferenceComparison !== 0) {
		return duprDifferenceComparison;
	}

	return getPairingSignature(left).localeCompare(getPairingSignature(right));
}

function getSkillDifference(pairing: TeamPairing) {
	const [firstTeam, secondTeam] = pairing;

	return Math.abs(getSkillTeamRating(firstTeam) - getSkillTeamRating(secondTeam));
}

function getStrongerSkillTeamRating(pairing: TeamPairing) {
	return Math.max(...pairing.map(getSkillTeamRating));
}

function getSkillTeamRating(team: Team) {
	return team.players.reduce((total, player) => total + skillLevelRatings[player.skillLevel], 0);
}

function getDuprDifference(pairing: TeamPairing) {
	const [firstTeam, secondTeam] = pairing;

	return Math.abs(getDuprTeamRating(firstTeam) - getDuprTeamRating(secondTeam));
}

function getDuprTeamRating(team: Team) {
	return team.players.reduce((total, player) => total + (player.dupr ?? 3.0), 0);
}

function getPairingSignature(pairing: TeamPairing) {
	return pairing
		.map((team) => team.players.map((player) => player.id).sort((left, right) => left - right).join('-'))
		.sort()
		.join('|');
}
