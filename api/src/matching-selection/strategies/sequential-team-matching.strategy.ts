import { TeamMatchingStrategy } from '../matching-selection.types';

export class SequentialTeamMatchingStrategy implements TeamMatchingStrategy {
  readonly name = 'sequential';

  buildTeams({ players }: { players: Parameters<TeamMatchingStrategy['buildTeams']>[0]['players'] }) {
    if (players.length !== 4) {
      return [];
    }

    return [
      {
        name: 'Team 1',
        players: players.slice(0, 2),
      },
      {
        name: 'Team 2',
        players: players.slice(2, 4),
      },
    ];
  }
}