import { Types, createComponent } from '@iwsdk/core';

/** Marks an entity the spirit brought into the room (props, overlays, the board). */
export const SpiritThing = createComponent('SpiritThing', {
  thingId: { type: Types.String, default: '' },
});

/** A poke/pinch button on an XR panel. */
export const UIButton = createComponent('UIButton', {
  action: { type: Types.String, default: '' },
});
