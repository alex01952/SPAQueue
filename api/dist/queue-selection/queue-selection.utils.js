"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlayerInOngoingGame = isPlayerInOngoingGame;
function isPlayerInOngoingGame(games, playerId) {
    return games.some((game) => game.status === 'ongoing' && game.playerIds.includes(playerId));
}
//# sourceMappingURL=queue-selection.utils.js.map