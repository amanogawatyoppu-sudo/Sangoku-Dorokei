import { describe, expect, it } from 'vitest';
import { MEETING_AUTO_CLOSE, SCHEDULED_MEETING_AT, SCHEDULED_MEETING_CLOSE, SCHEDULED_MEETING_WARN } from '../src/config/constants';
import { closeMeeting, openMeeting, openScheduledMeeting, voteInMeeting } from '../src/meeting/meetingSystem';
import { find, freezeOthers, newGame, placeAtBase, runFrames } from './helpers';

describe('meeting auto-close', () => {
  it('closes a meeting after 30s of real time', () => {
    const state = newGame();
    placeAtBase(state.player);
    expect(openMeeting(state)).toBe(true);
    runFrames(state, MEETING_AUTO_CLOSE - 500);
    expect(state.meeting).not.toBeNull();
    runFrames(state, 1000);
    expect(state.meeting).toBeNull();
    expect(state.events.some((e) => e.type === 'MEETING_CLOSED')).toBe(true);
  });

  it("a previous meeting's timeout does not close the next meeting", () => {
    const state = newGame();
    placeAtBase(state.player);
    openMeeting(state);
    runFrames(state, 20000);
    closeMeeting(state);
    placeAtBase(state.player);
    expect(openMeeting(state)).toBe(true);
    // 15s later the first meeting's 30s deadline has passed; the second must stay open.
    runFrames(state, 15000);
    expect(state.meeting).not.toBeNull();
    runFrames(state, 16000);
    expect(state.meeting).toBeNull();
  });
});

describe('meeting pause', () => {
  it('jail and execution timers do not advance while a meeting is open', () => {
    const state = newGame('sun', 'soldier');
    const prisoner = find(state, 'moon', 'keyholder');
    // Keep moon's own keyholder from rescuing and random jailbreaks out of the window.
    state.nextEventAt = Infinity;
    prisoner.jailed = true;
    prisoner.jailedAt = state.time;
    prisoner.capturedBy = 'sun';
    placeAtBase(state.player);
    openMeeting(state);
    const timeAtOpen = state.time;
    runFrames(state, 29000);
    expect(state.time).toBe(timeAtOpen);
    expect(prisoner.alive).toBe(true);
    expect(prisoner.jailed).toBe(true);
  });

  it('stun, sprint, radar and random-event timers keep their remaining time across a meeting', () => {
    const state = newGame('sun', 'soldier');
    const e = find(state, 'moon', 'ranger');
    e.stunUntil = state.time + 3000;
    e.sprintUntil = state.time + 8000;
    state.radar.star = state.time + 7000;
    const eventIn = state.nextEventAt - state.time;
    placeAtBase(state.player);
    openMeeting(state);
    runFrames(state, 25000);
    expect(e.stunUntil - state.time).toBe(3000);
    expect(e.sprintUntil - state.time).toBe(8000);
    expect(state.radar.star - state.time).toBe(7000);
    expect(state.nextEventAt - state.time).toBe(eventIn);
  });
});

describe('half-time meeting (ハーフタイム会議)', () => {
  it('is announced 5 s ahead, opens once at half time and pauses the match', () => {
    const state = newGame();
    state.nextEventAt = Infinity;
    freezeOthers(state, []);
    runFrames(state, SCHEDULED_MEETING_AT - SCHEDULED_MEETING_WARN + 200);
    expect(state.events.some((e) => e.type === 'MEETING_SOON')).toBe(true);
    expect(state.meeting).toBeNull();
    runFrames(state, SCHEDULED_MEETING_WARN);
    expect(state.meeting?.kind).toBe('scheduled');
    const t = state.time;
    runFrames(state, 5000);
    expect(state.time).toBe(t); // everyone is frozen while it is open
    runFrames(state, SCHEDULED_MEETING_CLOSE);
    expect(state.meeting).toBeNull(); // closes by itself after 20 s
    expect(state.nextMeetingAt).toBe(Infinity); // only once
    runFrames(state, 60000);
    expect(state.meeting).toBeNull();
  });

  it('reports the situation and the sightings by place, and every kingdom picks a search focus', () => {
    const state = newGame('sun', 'soldier');
    const enemy = find(state, 'moon', 'sniper');
    state.factions.sun.intel.set(enemy.id, { id: enemy.id, x: enemy.x, y: 0, z: enemy.z, t: state.time, vx: 0, vz: 0, since: state.time });
    openScheduledMeeting(state);
    const text = state.meeting!.lines.join('\n');
    expect(text).toContain('管制塔');
    expect(text).toContain('捕まっている人数');
    expect(text).toMatch(/目撃: 月国の人物1人/);
    // The AI kingdoms decided at once; the player's side waits for the vote.
    expect(state.teamFocus.moon).not.toBeNull();
    expect(state.teamFocus.star).not.toBeNull();
    expect(state.teamFocus.sun).toBeNull();
    // The sighting's place is the first voting option.
    expect(state.meeting!.zones[0].label).toContain('月1人');
  });

  it('without a vote, the teammates settle the focus by majority', () => {
    const state = newGame('sun', 'soldier');
    openScheduledMeeting(state);
    closeMeeting(state);
    expect(state.teamFocus.sun).not.toBeNull();
  });

  it('a vote sets the focus to the chosen place', () => {
    const state = newGame('sun', 'soldier');
    openScheduledMeeting(state);
    const z = state.meeting!.zones[1];
    voteInMeeting(state, 1);
    closeMeeting(state);
    expect(state.teamFocus.sun).toMatchObject({ x: z.x, z: z.z });
  });
});
