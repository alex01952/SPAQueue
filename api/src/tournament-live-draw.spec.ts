import {
  advanceLiveDraw, liveDrawPhase, liveDrawTimes, toLiveDrawView,
  LIVE_PRESENCE_MS, LIVE_REVEAL_MS, LIVE_RESULTS_MS, LIVE_VOTING_MS,
} from './tournament-live-draw';
import type { LiveDrawEvent } from './tournament-live-draw';

describe('Live tournament draw timeline', () => {
  const start = Date.parse('2026-10-23T10:00:00Z');
  function createEvent(): LiveDrawEvent {
    return {
      eventId: 'event', scheduledAt: start, poolCount: 2, rosterSignature: 'signature',
      createdBy: 'admin', presence: {
        a: start - 1000, b: start - LIVE_PRESENCE_MS,
        c: start - LIVE_PRESENCE_MS - 1, spectator: start - 1000,
      }, eligibleMemberIds: null, rerollVoterIds: [], initialDraw: null, rerollDraw: null,
      invalidated: false,
      roster: {
        tournamentId: 'tournament', tournamentName: 'Club Open', category: 'Mixed Doubles',
        level: 'Beginner', canManageRoster: false,
        teams: ['a', 'b', 'c', 'd'].map((id) => ({
          registrationId: `team-${id}`, status: 'Paid', isOwnTeam: false,
          players: [{ memberId: id, name: id, gender: 'Male' }],
        })),
      },
    };
  }

  it('freezes recent confirmed attendees exactly once and excludes stale connections and spectators', () => {
    const event = createEvent();
    advanceLiveDraw(event, start - 1);
    expect(event.initialDraw).toBeNull();
    advanceLiveDraw(event, start);
    expect(event.eligibleMemberIds).toEqual(['a', 'b']);
    expect(event.presence).toEqual({});
    const version = event.initialDraw!.version;
    event.presence.d = start + 1;
    advanceLiveDraw(event, start + 1000);
    expect(event.eligibleMemberIds).toEqual(['a', 'b']);
    expect(event.initialDraw!.version).toBe(version);
    expect(event.initialDraw!.pools.flatMap((pool) => pool.registrationIds).sort()).toEqual(['team-a', 'team-b', 'team-c', 'team-d']);
  });

  it('uses a full 60-second vote window and reveals vote totals for 10 seconds before generating any reroll', () => {
    const event = createEvent();
    const { votingAt, resultsAt, decisionAt, rerollEndsAt } = liveDrawTimes(event);
    expect(resultsAt - votingAt).toBe(LIVE_VOTING_MS);
    expect(decisionAt - resultsAt).toBe(LIVE_RESULTS_MS);
    advanceLiveDraw(event, start);
    event.rerollVoterIds = ['a', 'b'];
    expect(liveDrawPhase(event, start)).toBe('revealing');
    expect(toLiveDrawView(event, 'a', start).pools).toBeNull();
    expect(liveDrawPhase(event, votingAt)).toBe('voting');
    expect(toLiveDrawView(event, 'a', resultsAt - 1).voteResult).toBeNull();
    advanceLiveDraw(event, resultsAt);
    expect(liveDrawPhase(event, resultsAt)).toBe('results');
    expect(event.rerollDraw).toBeNull();
    expect(toLiveDrawView(event, 'a', resultsAt).voteResult).toEqual({ rerollVotes: 2, didNotVote: 0, reroll: true });
    advanceLiveDraw(event, decisionAt - 1);
    expect(event.rerollDraw).toBeNull();
    advanceLiveDraw(event, decisionAt);
    expect(liveDrawPhase(event, decisionAt)).toBe('rerolling');
    expect(event.rerollDraw).not.toBeNull();
    expect(toLiveDrawView(event, 'a', decisionAt).pools).toBeNull();
    const version = event.rerollDraw!.version;
    advanceLiveDraw(event, rerollEndsAt + 100_000);
    expect(liveDrawPhase(event, rerollEndsAt)).toBe('final');
    expect(event.rerollDraw!.version).toBe(version);
    expect(toLiveDrawView(event, 'a', rerollEndsAt).pools).toEqual(event.rerollDraw!.pools);
  });

  it.each([0, 1])('does not reroll with %s votes out of two eligible players (a tie is not a majority)', (votes) => {
    const event = createEvent();
    advanceLiveDraw(event, start);
    event.rerollVoterIds = ['a'].slice(0, votes);
    const { resultsAt, decisionAt } = liveDrawTimes(event);
    advanceLiveDraw(event, resultsAt);
    expect(liveDrawPhase(event, resultsAt)).toBe('results');
    expect(toLiveDrawView(event, 'b', resultsAt).voteResult?.reroll).toBe(false);
    advanceLiveDraw(event, decisionAt);
    expect(liveDrawPhase(event, decisionAt)).toBe('final');
    expect(event.rerollDraw).toBeNull();
    expect(toLiveDrawView(event, 'b', decisionAt).pools).toEqual(event.initialDraw!.pools);
  });

  it('finalizes without reroll when nobody attends and catches up after downtime without opening late voting', () => {
    const event = createEvent();
    event.presence = {};
    advanceLiveDraw(event, start + LIVE_REVEAL_MS + LIVE_VOTING_MS + LIVE_RESULTS_MS + 1000);
    const view = toLiveDrawView(event, 'a', start + 1_000_000);
    expect(view.phase).toBe('final');
    expect(view.eligibleCount).toBe(0);
    expect(view.canVote).toBe(false);
    expect(view.voteResult?.reroll).toBe(false);
  });

  it('never reveals assignments, votes or advances an invalidated draw', () => {
    const event = createEvent();
    event.invalidated = true;
    advanceLiveDraw(event, start + 1_000_000);
    expect(event.initialDraw).toBeNull();
    expect(toLiveDrawView(event, 'a', start).phase).toBe('invalidated');
    expect(toLiveDrawView(event, 'a', start).pools).toBeNull();
    expect(toLiveDrawView(event, 'a', start).voteResult).toBeNull();
  });
});
