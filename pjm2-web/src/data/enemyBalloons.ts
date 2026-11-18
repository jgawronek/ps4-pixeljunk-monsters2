// Enemy prefabs that spawn on balloons (EnemyBase.spawnMode == Balloon; audit: docs/STAGE_GAMEPLAY_AUDIT.md).
// Each carries a Q4.Balloon component: Balloons.Length = 3, hp = 225 (decomp/data/enemies_Balloon.json, 12/12 identical).
export const BALLOON_ENEMIES: Readonly<Record<string, true>> = {
  cisors_03_001: true, cisors_04_001: true, cisors_05_001: true,
  giant_03_001: true, giant_04_001: true, giant_05_001: true,
  kuri_03_001: true, kuri_04_001: true, kuri_05_001: true,
  spider_03_001: true, spider_04_001: true, spider_05_001: true,
};
