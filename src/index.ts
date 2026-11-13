import { DepthSensingSystem, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import type { SaveData } from './core/progress.js';
import type { Game } from './game/game.js';
import { AudioDirectorSystem } from './systems/audio-system.js';
import { EvidenceSystem } from './systems/evidence-system.js';
import { FxSystem } from './systems/fx-system.js';
import { GameSystem } from './systems/game-system.js';
import { HudSystem } from './systems/hud-system.js';

type Settings = SaveData['settings'];

interface PageHooks {
  __beginXR?: () => Promise<unknown> | unknown;
  __setSetting?: (key: keyof Settings, value: boolean) => void;
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(DepthSensingSystem, {
    configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true, blurRadius: 20 },
  });
  world.registerSystem(GameSystem);
  world.registerSystem(FxSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(EvidenceSystem);
  world.registerSystem(AudioDirectorSystem);

  // The start page's button and settings talk to the game through these.
  const hooks = window as unknown as PageHooks;
  hooks.__beginXR = () => world.launchXR();
  hooks.__setSetting = (key, value) => {
    const game = world.globals.game as Game | undefined;
    if (game) game.save.settings[key] = value;
  };
  world.visibilityState.subscribe((state) => {
    document.body.classList.toggle('in-xr', state !== VisibilityState.NonImmersive);
  });
});
