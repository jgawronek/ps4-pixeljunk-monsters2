using System;
using System.Linq;
using GameData;
class P {
  static void Main() {
    var L = new GameDataLoader("/srv/opencode/ps3-pixeljunk-monsters2/decomp/data");
    L.LoadAll();
    Console.WriteLine($"Enemies loaded : {L.Enemies.Count}");
    Console.WriteLine($"Towers loaded  : {L.Towers.Count}");
    Console.WriteLine($"Stages loaded  : {L.Stages.Count}");
    Console.WriteLine($"Difficulties   : {L.Difficulties.Count}");
    Console.WriteLine($"Areas          : {L.Areas.Count} (stages: {L.Areas.Sum(a=>a.stageInfos.Count)})");
    // spot-check an enemy
    var kuri = L.Enemies["kuri_00_001"];
    Console.WriteLine($"\nkuri_00_001: life={kuri.maxLife} speed={kuri.speed:F3} move={kuri.enemyMoveType} exp={kuri.expValue} attrSets={kuri.attributes.Count}");
    // spot-check a tower + upgrades
    var t4 = L.Towers["tower_004"];
    Console.WriteLine($"tower_004: pow={t4.attackPower} spd={t4.attackSpeed} coin={t4.costCoin} gem={t4.costGem} atk={t4.attackType} upgrades={t4.upgrades.Count}");
    if (t4.upgrades.Count>0){var u=t4.upgrades[0];Console.WriteLine($"  upg Lv{u.level}: reachExp={u.reachExp} pow={u.attackPower} costGem={u.costGem}");}
    // stage 1 first + last wave
    var s1 = L.Stages.OrderBy(s=>s.index).First(s=>s.stageName=="tl_stage_001");
    Console.WriteLine($"\nSTAGE {s1.stageName} area={s1.areaName} initCoin={s1.initCoin} waves={s1.waves.Count} coinRate={s1.waveCoinRate:F2}");
    void DumpWave(int wi){
      var w=s1.waves[wi]; var d0=w.perDifficulty[0];
      var names=d0.spawns.GroupBy(sp=>sp.enemy).Select(g=>$"{g.Key}x{g.Sum(x=>x.enemySpawnNum)}");
      Console.WriteLine($"  wave {wi+1}: {string.Join(", ", names)}  (paths: {string.Join(",", d0.spawns.Select(sp=>sp.pathName).Distinct())})");
    }
    DumpWave(0); DumpWave(1); DumpWave(s1.waves.Count-1);
    // verify every spawn enemy resolves to a loaded definition
    int missing=0, total=0;
    foreach(var st in L.Stages) foreach(var w in st.waves) foreach(var d in w.perDifficulty) foreach(var sp in d.spawns){
      total++; if(sp.enemy!=null && !L.Enemies.ContainsKey(sp.enemy)) missing++;
    }
    Console.WriteLine($"\nSpawn->EnemyDef resolution: {total-missing}/{total} resolved, {missing} missing");
    Console.WriteLine(missing==0 ? "DATA_LAYER_OK" : "DATA_LAYER_HAS_GAPS");
  }
}
