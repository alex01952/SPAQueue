import { buildCourts } from '../matching-selection';
import { NextGamePreview, PlayerQueueState, QueueSelectionMode } from '../queue.types';
import { isPlayerInOngoingGame } from './queue-selection.utils';
import { QueueSelectionContext } from './queue-selection.types';

export function buildNextGamePreview(
  context: QueueSelectionContext,
  selectionMode: QueueSelectionMode,
  getQueueTimestamp: (player: PlayerQueueState) => string | null,
): NextGamePreview {
  const courtCount = Math.max(1, Math.floor(context.courtCount || 1));
  const eligiblePlayers = context.players
    .filter((player) => player.isReady && !isPlayerInOngoingGame(context.games, player.id))
    .sort((left, right) => comparePlayers(left, right, getQueueTimestamp));

  const selectedPlayers = eligiblePlayers.slice(0, courtCount * 4);

  return {
    courtCount,
    selectionMode,
    matchingMode: context.matchingMode,
    eligiblePlayers,
    selectedPlayers,
    courts: buildCourts(selectedPlayers, context.matchingMode),
  };
}

function comparePlayers(
  left: PlayerQueueState,
  right: PlayerQueueState,
  getQueueTimestamp: (player: PlayerQueueState) => string | null,
) {
  const queueComparison = compareTimestamps(getQueueTimestamp(left), getQueueTimestamp(right));

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
