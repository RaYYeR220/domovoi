import { AssetType, defineAssets } from '@iwsdk/core';

const url = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const model = (file: string, name: string) => ({
  url: url(`models/${file}`),
  type: AssetType.GLTF,
  name,
  priority: 'lazy' as const,
});

export default defineAssets({
  'prop-teacup': model('teacup.glb', 'Teacup'),
  'prop-milk-bowl': model('milk-bowl.glb', 'Milk bowl'),
  'prop-candle': model('candlestick.glb', 'Candlestick'),
  'prop-clock': model('alarm-clock.glb', 'Alarm clock'),
  'prop-plant': model('potted-plant.glb', 'Potted plant'),
  'prop-books': model('book-stack.glb', 'Books'),
  'prop-frame': model('picture-frame.glb', 'Picture frame'),
  'prop-jug': model('milk-jug.glb', 'Milk jug'),
  'prop-toy': model('wooden-elephant.glb', 'Wooden elephant'),
  'prop-lantern': model('lantern.glb', 'Lantern'),
  'prop-apple': model('apple.glb', 'Apple'),
  'prop-spectacles': model('spectacles.glb', 'Spectacles'),
  'prop-watch': model('pocket-watch.glb', 'Pocket watch'),
  'prop-spoon': model('wooden-spoon.glb', 'Wooden spoon'),
  'env-studio': {
    url: url('models/brown-photostudio-02-1k.hdr'),
    type: AssetType.HDRTexture,
    name: 'Studio light',
    priority: 'critical',
  },
});
