//@flow
import vec3 from "gl-vec3";
import mat3 from "gl-mat3";
import smoothstep from "smoothstep";
import {
  DEV,
  TRACK_SIZE,
  STATUS_FINISHED,
  STATUS_GAMEOVER,
  STATUS_RUNNING,
  ALTT_OFF,
  ALTT_CART_ON,
  ALTT_CART_OFF,
  TURN_DX,
  DESCENT_DY
} from "../Constants";
import genTrack from "./genTrack";
import debugFreeControls from "./debugFreeControls";
import trackToCoordinates from "./trackToCoordinates";
import restart from "./restart";
import levelUp from "./levelUp";
import tutorial from "./tutorial";
import * as Debug from "../../Debug";
import type { GameState, TrackBiome, UserEvents } from "./types";

function setMatRot(rot: Array<number>, rotX: number, rotY: number) {
  const cx = Math.cos(rotX);
  const sx = Math.sin(rotX);
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  // prettier-ignore
  mat3.multiply(
    rot,
    [
      1, 0, 0,
      0, cx, sx,
      0, -sx, cx
    ],
    [
      cy, 0, sy,
      0, 1, 0,
      -sy, 0, cy
    ]
  );
  mat3.transpose(rot, rot);
}

function correctDirection(g: GameState, biome: TrackBiome): boolean {
  return (
    Boolean(g.switchDirectionTarget < 0) === Boolean(biome.biomeSeed > 0.5)
  );
}

/*
// HACK altTrackOffset (tmp rendering)
// FIXME better idea: when the track is in future, we'll just use the same track data (optim: the loop only opU for the alt tracks so maybe we need to know the intersection index (futureIntersection index ?))
const offZ = 4;
altTrackOffset = [0, 0, offZ];
for (let i = 0; i < offZ; i++) {
  altTrackOffset[0] += 1.5 * (trackData[4 * i] / 255 - 0.5);
  altTrackOffset[1] += -0.6 * (trackData[4 * i + 1] / 255);
}
*/

if (DEV) {
  Debug.defineEditable("freeControls", false);
}

export default (
  previousState: GameState,
  { time, tick }: { time: number, tick: number },
  userEvents: UserEvents
): GameState => {
  let g = { ...previousState };

  // sync time / step / ...

  if (g.time === 0) {
    g.startTime = time;
    g.statusChangedTime = time;
    g.stepTime = time;
    g.stepTick = tick;
    g.time = time;
    g.tick = tick;
  }
  const dt = Math.min(time - g.time, 100 /* safe dt */);
  g.time = time;
  g.tick = tick;

  // consume user events
  const freeControls = DEV && Debug.getEditable("freeControls");
  const spacePressed = userEvents.spacePressed;

  // Handle Tutorial related
  if (tutorial.condition(g, userEvents)) {
    const tut = tutorial.steps[g.tutorial];
    Debug.log("tut", g.tutorial);
    if (tut) {
      if (g.uiState === tut.uiState) {
        // is already current tut
        if (tut.conditionLeave(g, userEvents)) {
          g.tutorial++;
        } else {
          g = tut.tick(g, userEvents);
        }
      } else if (tut.conditionSkip(g, userEvents)) {
        // tut to be skipped
        g.tutorial++;
      } else if (tut.conditionEnter(g, userEvents)) {
        // tut entered
        g.uiState = tut.uiState;
      } else {
        g.uiState = null;
      }
    } else {
      g.uiState = null;
    }
  }

  if (g.level >= 0) {
    // User in control!
    if (freeControls) {
      debugFreeControls(g, userEvents);
    }
    if (userEvents.keyRightDelta) {
      g.switchDirectionTarget = userEvents.keyRightDelta;
    }
    g.braking += (userEvents.spacePressed - g.braking) * 0.1;

    if (g.status === STATUS_GAMEOVER && g.time - g.statusChangedTime > 4) {
      return restart(g);
    }
    if (g.status === STATUS_FINISHED && g.time - g.statusChangedTime > 4) {
      return levelUp(g);
    }
  } else {
    // start screen, demo in control!

    if (spacePressed) {
      return levelUp(g);
    }

    if (g.status !== STATUS_RUNNING) {
      if (g.status === STATUS_FINISHED || g.time - g.statusChangedTime > 3) {
        return restart(g);
      }
    }

    const firstTrack = g.track[0];

    if (firstTrack && firstTrack.intersectionBiome) {
      g.switchDirectionTarget = correctDirection(
        g,
        firstTrack.intersectionBiome
      )
        ? g.switchDirectionTarget
        : -g.switchDirectionTarget;
    } else {
      if (g.tick % 60 === 0) {
        g.switchDirectionTarget = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  if (g.stepIndex < 0) {
    g.status = STATUS_FINISHED;
    return g;
  }

  // sync tracks / trackStep

  g.trackStepProgress += dt * g.speed;
  if (g.trackStepProgress >= 1) {
    // new step
    if (DEV) {
      Debug.log("fps", Math.round((tick - g.stepTick) / (time - g.stepTime)));
    }
    g.stepTick = tick;
    g.stepTime = time;
    g.trackStepProgress = 0;
    g.stepIndex--;
    const droppedTrack = g.track[0];
    g.track = g.track.slice(1);
    g.track.push(genTrack(g.stepIndex - TRACK_SIZE + 1, g.seed));

    const { intersectionBiome } = g.track[0];
    if (intersectionBiome) {
      g.intersectionBiomeEnd =
        intersectionBiome.duration - intersectionBiome.index;
    }
    if (
      intersectionBiome &&
      intersectionBiome.index >= intersectionBiome.duration - 1 &&
      g.altTrackMode === ALTT_CART_ON
    ) {
      g.status = STATUS_GAMEOVER;
    } else if (
      intersectionBiome &&
      intersectionBiome.index < intersectionBiome.duration
    ) {
      const droppedAltTrack = g.altTrack[0];
      g.altTrack = g.track.map((t, i) => {
        const track = { ...t };
        if (intersectionBiome.index + i >= 0) {
          track.turn *= -1;
        }
        return track;
      });

      if (droppedAltTrack) {
        g.altTrackOffset[0] -=
          TURN_DX * (droppedTrack.turn - droppedAltTrack.turn);
        g.altTrackOffset[1] -=
          DESCENT_DY * (droppedTrack.descent - droppedAltTrack.descent);
      }

      const altTrackHasDiverged =
        intersectionBiome.index > 0 && g.altTrackOffset[0] !== 0;

      const directionIsCorrect = correctDirection(g, intersectionBiome);
      if (!altTrackHasDiverged || g.altTrackMode === ALTT_OFF) {
        g.altTrackMode = directionIsCorrect ? ALTT_CART_OFF : ALTT_CART_ON;
      }
    } else if (g.altTrackMode !== ALTT_OFF) {
      // there used to be altTrack but we no longer is in INTERS biome
      // Continue the game
      g.altTrack = [];
      g.altTrackMode = ALTT_OFF;
      g.altTrackOffset = [0, 0, 0];
    }
  }

  const trackCoords = trackToCoordinates(g.track);
  const altTrackCoords = trackToCoordinates(g.altTrack);

  const descent = g.track[0].descent + 0.001;
  const frictionFactor = 0.003;
  const speedFriction = Math.pow(1 - frictionFactor, 60 * dt);
  const accFriction = Math.pow(1 - 0.2 * frictionFactor, 60 * dt);

  g.acc = Math.max(0, Math.min((g.acc + 0.2 * descent * dt) * accFriction, 4));
  g.acc -= g.braking * 0.4 * dt;
  g.speed = Math.max(0, Math.min((g.speed + dt * g.acc) * speedFriction, 20));

  if (g.status === STATUS_GAMEOVER) {
    g.acc = 0;
    g.speed = Math.max(0, (0 - g.speed) * 0.01);
    g.trackStepProgress = 0.0;
    g.rotX += (-0.9 - g.rotX) * 0.008;
    g.rotY += (Math.atan(trackCoords[0][0]) + 0.7 - g.rotY) * 0.008;
    g.zoomOut += (1 - g.zoomOut) * 0.008;
  } else {
    Debug.log("descent", descent);
    Debug.log("acc", g.acc);
    Debug.log("speed", g.speed);

    if (!freeControls) {
      let targetRotX, targetRotY;
      const n = Math.max(2, Math.min(3, TRACK_SIZE - 1));
      const targetP = vec3.create();
      const relativeFirst = vec3.create();
      const relativeLast = vec3.create();
      const { intersectionBiome } = g.track[0];
      const focusOnAltTrack =
        intersectionBiome && g.altTrackMode === ALTT_CART_ON; // FIXME something not correct after diverge

      const coords = focusOnAltTrack ? altTrackCoords : trackCoords;

      vec3.scale(relativeFirst, coords[1], 1 - g.trackStepProgress);
      vec3.subtract(relativeLast, coords[n + 1], coords[n]);
      vec3.scale(relativeLast, relativeLast, g.trackStepProgress);
      vec3.add(targetP, coords[n], relativeFirst);
      vec3.add(targetP, targetP, relativeLast);
      // targetP = (1-p)*c[1] + c[n] + (c[n+1]-c[c])*p
      targetRotX = Math.atan(-0.4 + 0.5 * targetP[1] / n);
      targetRotY = Math.atan(0.8 * targetP[0] / n);
      g.rotX += (targetRotX - g.rotX) * 0.03;
      g.rotY += (targetRotY - g.rotY) * 0.03;
      // FIXME is the rotation correct? why is the camera weird like on a boat XD
    }

    g.switchDirection += (g.switchDirectionTarget - g.switchDirection) * 0.1;
  }

  setMatRot(g.rot, g.rotX, g.rotY);

  g.origin = [
    0.0 - 1 * g.zoomOut,
    0.05 + 1.5 * g.zoomOut,
    1.4 +
      Math.min(0.0, 0.2 * g.braking - 0.2 * smoothstep(0.0, 6.0, g.speed)) -
      0.2 * g.zoomOut
  ];

  Debug.log("stepIndex", g.stepIndex);
  /*
  Debug.log("altTrackMode", g.altTrackMode);
  Debug.log(
    "trackBiome",
    g.track[0].biomeMix === 0
      ? g.track[0].biome1.type
      : g.track[0].biomeMix === 1
        ? g.track[0].biome2.type
        : g.track[0].biome1.type +
          "–>" +
          g.track[0].biome2.type +
          " % " +
          g.track[0].biomeMix.toFixed(2)
  );
  */

  // Sync UI
  if (g.level > 0) {
    if (g.status === STATUS_GAMEOVER) {
      g.uiState = {
        titleCentered: true,
        title: "Oops!",
        body: "Remember for\nnext run"
      };
    } else if (g.status === STATUS_GAMEOVER) {
      g.uiState = {
        titleCentered: true,
        title: "YES!",
        body: "You did it!",
        footer: "Try a longer run..."
      };
    }
  }

  if (previousState.status !== g.status) {
    g.statusChangedTime = g.time;
  }

  return g;
};