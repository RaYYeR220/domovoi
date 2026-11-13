export async function run({ page, frame }) {
  const app = frame ?? page;
  return app.evaluate(async () => {
    const g = window.__domovoi;
    const out = [];
    const AssetManager = window.__assets;
    for (const kind of ['teacup', 'candle', 'clock', 'jug']) {
      const id = 'prop-' + kind;
      const gltf = AssetManager?.getGLTF?.(id, { shared: true });
      let maps = 0, mats = 0;
      gltf?.scene?.traverse((o) => { if (o.material) { mats++; if (o.material.map && o.material.map.image) maps++; } });
      out.push(`${id}: mats=${mats} withMap=${maps}`);
    }
    return out.join('\n') + `\nprops placed: ${g ? g.props.size : 'n/a'}`;
  });
}
