import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './systems/game-system.js';
import { FxSystem } from './systems/fx-system.js';
import { HudSystem } from './systems/hud-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(GameSystem);
  world.registerSystem(FxSystem);
  world.registerSystem(HudSystem);
});
