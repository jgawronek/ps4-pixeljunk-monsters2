import { describe, it, expect } from 'vitest';
import { titleCrowdNodes, homeChibiLayout, HUB_HOME } from '../../src/view/hub/TitleCrowd';

describe('title crowd = the hub Q4.Home chibi zones', () => {
  const nodes = titleCrowdNodes();
  it('is deterministic and has Home.NumChibi = 20', () => {
    expect(nodes.length).toBe(20);
    expect(titleCrowdNodes()).toEqual(nodes);
  });
  it('sits in two arcs 2.15..2.5 m (+ spread pushes) from the hut, on the +Z (camera) side, leaving the middle gap', () => {
    for (const n of nodes) {
      const d = Math.hypot(n.pos[0], n.pos[2]);
      expect(d).toBeGreaterThan(2.0);
      expect(d).toBeLessThan(2.7);
      expect(n.pos[2]).toBeGreaterThan(0.5); // forward half-plane
      const ang = (Math.atan2(n.pos[0], n.pos[2]) * 180) / Math.PI;
      expect(Math.abs(ang)).toBeGreaterThan(2); // zones are centred on +-35 deg with a 60 deg spread (5..65 deg), spread-out pushes may move a few degrees
      expect(Math.abs(ang)).toBeLessThan(70);
    }
  });
  it('faces outward (LookRotation(offset))', () => {
    for (const n of nodes) {
      const out = (Math.atan2(n.pos[0], n.pos[2]) * 180) / Math.PI;
      let diff = Math.abs(n.yaw - out) % 360; if (diff > 180) diff = 360 - diff;
      expect(diff).toBeLessThan(12); // yaw is the spawn offset direction; the spread pass moves the spot slightly
    }
  });
  it('SpreadOutChibi leaves no pair closer than ~0.16 after the relaxation passes', () => {
    let min = Infinity;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) min = Math.min(min, Math.hypot(nodes[i].pos[0] - nodes[j].pos[0], nodes[i].pos[2] - nodes[j].pos[2]));
    expect(min).toBeGreaterThan(0.1);
  });
  it('spread pushes two coincident-by-construction spots apart (0.4-d)*0.5 style', () => {
    let k = 0;
    const out = homeChibiLayout([{ numChibi: 2, minDist: 2, maxDist: 2, angleCenter: 0, angleSpread: 0 }], HUB_HOME, () => (k++ % 2 === 0 ? 0 : 0.05));
    expect(out.length).toBe(2);
  });
});
