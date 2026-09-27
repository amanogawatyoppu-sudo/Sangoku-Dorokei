import { describe, expect, it } from 'vitest';
import { MEETING_AUTO_CLOSE } from '../src/config/constants';
import { closeMeeting, openMeeting } from '../src/meeting/meetingSystem';
import { find, newGame, placeAtBase, runFrames } from './helpers';

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

  it('stun, disguise, radar and random-event timers keep their remaining time across a meeting', () => {
    const state = newGame('sun', 'soldier');
    const e = find(state, 'moon', 'impostor');
    e.stunUntil = state.time + 3000;
    e.fakeUntil = state.time + 8000;
    state.radar.star = state.time + 7000;
    const eventIn = state.nextEventAt - state.time;
    placeAtBase(state.player);
    openMeeting(state);
    runFrames(state, 25000);
    expect(e.stunUntil - state.time).toBe(3000);
    expect(e.fakeUntil - state.time).toBe(8000);
    expect(state.radar.star - state.time).toBe(7000);
    expect(state.nextEventAt - state.time).toBe(eventIn);
  });
});
