import { buildCourts } from '../../matching-selection';
import { NextGamePreview, PlayerQueueState } from '../../queue.types';
import { QueueSelectionContext, QueueSelectionStrategy } from '../queue-selection.types';
import { isPlayerInOngoingGame } from '../queue-selection.utils';

export class LeastPlayedFirstQueueSelectionStrategy implements QueueSelectionStrategy {
	readonly name = 'least-played-first';

	selectNextPlayers(context: QueueSelectionContext): NextGamePreview {
		const courtCount = Math.max(1, Math.floor(context.courtCount || 1));
		const eligiblePlayers = context.players
			.filter((player) => player.isReady && !isPlayerInOngoingGame(context.games, player.id))
			.sort(comparePlayersByRecentGames);

		const selectedPlayers = eligiblePlayers.slice(0, courtCount * 4);

		return {
			courtCount,
			selectionMode: this.name,
			matchingMode: context.matchingMode,
			eligiblePlayers,
			selectedPlayers,
			courts: buildCourts(selectedPlayers, context.matchingMode),
		};
	}
}

function comparePlayersByRecentGames(left: PlayerQueueState, right: PlayerQueueState) {
	const recentGamesComparison = left.recentGamesPlayed - right.recentGamesPlayed;

	if (recentGamesComparison !== 0) {
		return recentGamesComparison;
	}

	const queueComparison = compareTimestamps(left.queueEnteredAt, right.queueEnteredAt);

	if (queueComparison !== 0) {
		return queueComparison;
	}

	const checkInComparison = compareTimestamps(left.checkedInAt, right.checkedInAt);

	if (checkInComparison !== 0) {
		return checkInComparison;
	}

	return left.name.localeCompare(right.name);
}

function compareTimestamps(left: string | null, right: string | null) {
	if (left && right) {
		return left.localeCompare(right);
	}

	if (left) {
		return -1;
	}

	if (right) {
		return 1;
	}

	return 0;
}
