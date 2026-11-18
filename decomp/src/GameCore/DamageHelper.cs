// GameCore/DamageHelper.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Static damage/reaction math. Enemies carry per-strength and per-class damage tables
// (Q4.EnemyAttributesSettings on the view's collider GameObject). Each entry has a
// damageTime and reactionTime multiplier; "strong" means the multiplier > 1.
// Field offsets from global-metadata.dat; logic from Ghidra (RVA 0x93D4C0..0x9443E0).
// All default multipliers resolve to 1.0f in the binary.

using System.Collections.Generic;
using UnityEngine;
using Q4; // EnemyAttributesSettings, StrengthDamageInfo, ClassDamageInfo, EnemyBase,
          // GameCoreBridge, GlobalSounds, TowerBase, enums

namespace GameCore
{
    public static class DamageHelper
    {
        // StrongDamageStrengthTypes @0x9423A0 — strength types this enemy takes >1x damage from.
        public static List<EEnemyStrengthTypeDef> StrongDamageStrengthTypes(GameObject enemy)
        {
            var result = new List<EEnemyStrengthTypeDef>();
            EnemyAttributesSettings attrs = enemy.GetComponent<EnemyAttributesSettings>();
            foreach (StrengthDamageInfo info in attrs.strengthDamageInfos)
            {
                if (info.damageTime > 1.0f)
                    result.Add(info.strength);
            }
            return result;
        }

        // StrongDamageClassTypes @0x9425E0
        public static List<EEnemyClassTypeDef> StrongDamageClassTypes(GameObject enemy)
        {
            var result = new List<EEnemyClassTypeDef>();
            EnemyAttributesSettings attrs = enemy.GetComponent<EnemyAttributesSettings>();
            foreach (ClassDamageInfo info in attrs.classDamageInfos)
            {
                if (info.damageTime > 1.0f)
                    result.Add(info.classType);
            }
            return result;
        }

        // WeakDamageStrengthTypes @0x942820 — strength types this enemy takes <1x damage from.
        public static List<EEnemyStrengthTypeDef> WeakDamageStrengthTypes(GameObject enemy)
        {
            var result = new List<EEnemyStrengthTypeDef>();
            EnemyAttributesSettings attrs = enemy.GetComponent<EnemyAttributesSettings>();
            foreach (StrengthDamageInfo info in attrs.strengthDamageInfos)
            {
                if (info.damageTime < 1.0f)
                    result.Add(info.strength);
            }
            return result;
        }

        // WeakDamageClassTypes @0x942A60
        public static List<EEnemyClassTypeDef> WeakDamageClassTypes(GameObject enemy)
        {
            var result = new List<EEnemyClassTypeDef>();
            EnemyAttributesSettings attrs = enemy.GetComponent<EnemyAttributesSettings>();
            foreach (ClassDamageInfo info in attrs.classDamageInfos)
            {
                if (info.damageTime < 1.0f)
                    result.Add(info.classType);
            }
            return result;
        }

        // DamageRateByStrength @0x942CA0 (table overload) — damageTime for the matching strength.
        public static float DamageRateByStrength(EEnemyStrengthTypeDef towerStrength, List<StrengthDamageInfo> strenthTable)
        {
            float rate = 1.0f;
            if (strenthTable != null)
            {
                foreach (StrengthDamageInfo info in strenthTable)
                {
                    if (info.strength == towerStrength)
                    {
                        rate = info.damageTime;
                        break;
                    }
                }
            }
            return rate;
        }

        // DamageRateByStrength @0x942E30 (target overload)
        public static float DamageRateByStrength(EEnemyStrengthTypeDef towerStrength, GameCoreObject target)
        {
            float rate = 1.0f;
            if (target != null)
            {
                GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(target.handle);
                if (view != null)
                {
                    EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
                    if (attrs != null)
                        rate = DamageRateByStrength(towerStrength, attrs.strengthDamageInfos);
                }
            }
            return rate;
        }

        // DamageRateByClass @0x942FA0 (table overload)
        public static float DamageRateByClass(EEnemyClassTypeDef towerClass, List<ClassDamageInfo> classTable)
        {
            float rate = 1.0f;
            if (classTable != null)
            {
                foreach (ClassDamageInfo info in classTable)
                {
                    if (info.classType == towerClass)
                    {
                        rate = info.damageTime;
                        break;
                    }
                }
            }
            return rate;
        }

        // DamageRateByClass @0x943130 (target overload)
        public static float DamageRateByClass(EEnemyClassTypeDef towerClass, GameCoreObject target)
        {
            float rate = 1.0f;
            if (target != null)
            {
                GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(target.handle);
                if (view != null)
                {
                    EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
                    if (attrs != null)
                        rate = DamageRateByClass(towerClass, attrs.classDamageInfos);
                }
            }
            return rate;
        }

        // DamageRateByAttributes @0x9432A0 (settings overload)
        public static float DamageRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, EnemyAttributesSettings attributes)
        {
            if (attributes == null)
                return 1.0f;
            return DamageRateByStrength(towerStrength, attributes.strengthDamageInfos)
                 * DamageRateByClass(towerClass, attributes.classDamageInfos);
        }

        // DamageRateByAttributes @0x943350 (tables overload)
        public static float DamageRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, List<StrengthDamageInfo> strenthTable, List<ClassDamageInfo> classTable)
        {
            return DamageRateByStrength(towerStrength, strenthTable) * DamageRateByClass(towerClass, classTable);
        }

        // DamageRateByAttributes @0x943390 (target overload)
        public static float DamageRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, GameCoreObject target)
        {
            return DamageRateByStrength(towerStrength, target) * DamageRateByClass(towerClass, target);
        }

        // DamageByStrength @0x9433D0 (table overload)
        public static float DamageByStrength(EEnemyStrengthTypeDef towerStrength, List<StrengthDamageInfo> strengthInfos, float damage)
        {
            return DamageRateByStrength(towerStrength, strengthInfos) * damage;
        }

        // DamageByStrength @0x9433F0 (target overload)
        public static float DamageByStrength(EEnemyStrengthTypeDef towerStrength, GameCoreObject target, float damage)
        {
            return DamageRateByStrength(towerStrength, target) * damage;
        }

        // DamageByClass @0x943410 (table overload)
        public static float DamageByClass(EEnemyClassTypeDef towerClass, List<ClassDamageInfo> classInfos, float damage)
        {
            return DamageRateByClass(towerClass, classInfos) * damage;
        }

        // DamageByClass @0x943430 (target overload)
        public static float DamageByClass(EEnemyClassTypeDef towerClass, GameCoreObject target, float damage)
        {
            return DamageRateByClass(towerClass, target) * damage;
        }

        // DamageByAttributes @0x943450 (settings overload)
        public static float DamageByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, EnemyAttributesSettings settings, float damage)
        {
            if (settings != null)
                damage = DamageRateByStrength(towerStrength, settings.strengthDamageInfos)
                       * DamageRateByClass(towerClass, settings.classDamageInfos) * damage;
            return damage;
        }

        // DamageByAttributes @0x943500 (tables overload)
        public static float DamageByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, List<StrengthDamageInfo> strengthTable, List<ClassDamageInfo> classTable, float damage)
        {
            return DamageRateByStrength(towerStrength, strengthTable) * DamageRateByClass(towerClass, classTable) * damage;
        }

        // DamageByAttributes @0x93D4C0 (target overload)
        public static float DamageByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, GameCoreObject target, float damage)
        {
            if (target != null)
                damage = DamageRateByStrength(towerStrength, target) * DamageRateByClass(towerClass, target) * damage;
            return damage;
        }

        // DamageStrongToEnemyByClass @0x943540 (table overload)
        public static bool DamageStrongToEnemyByClass(EEnemyClassTypeDef towerClass, List<ClassDamageInfo> classInfos)
        {
            return DamageRateByClass(towerClass, classInfos) > 1.0f;
        }

        // DamageStrongToEnemyByClass @0x943560 (target overload)
        public static bool DamageStrongToEnemyByClass(EEnemyClassTypeDef towerClass, GameCoreObject to)
        {
            return DamageRateByClass(towerClass, to) > 1.0f;
        }

        // ReactionStrongToEnemybyClass @0x943580 (table overload) — note original lowercase 'b'.
        public static bool ReactionStrongToEnemybyClass(EEnemyClassTypeDef towerClass, List<ClassDamageInfo> classInfos)
        {
            return ReactionRateByClass(towerClass, classInfos) > 1.0f;
        }

        // ReactionStrongToEnemyByClass @0x943730 (target overload)
        public static bool ReactionStrongToEnemyByClass(EEnemyClassTypeDef towerClass, GameCoreObject to)
        {
            return ReactionRateByClass(towerClass, to) > 1.0f;
        }

        // DamageStrongToEnemyByStrength @0x9438C0 (table overload)
        public static bool DamageStrongToEnemyByStrength(EEnemyStrengthTypeDef towerStrength, List<StrengthDamageInfo> strengthInfos)
        {
            return DamageRateByStrength(towerStrength, strengthInfos) > 1.0f;
        }

        // DamageStrongToEnemyByStrength @0x9438E0 (target overload)
        public static bool DamageStrongToEnemyByStrength(EEnemyStrengthTypeDef towerStrength, GameCoreObject to)
        {
            return DamageRateByStrength(towerStrength, to) > 1.0f;
        }

        // ReactionStrongToEnemyByStrength @0x943900 (table overload)
        public static bool ReactionStrongToEnemyByStrength(EEnemyStrengthTypeDef towerStrength, List<StrengthDamageInfo> strengthInfos)
        {
            return ReactionRateByStrength(towerStrength, strengthInfos) > 1.0f;
        }

        // ReactionStrongToEnemyByStrength @0x943AB0 (target overload)
        public static bool ReactionStrongToEnemyByStrength(EEnemyStrengthTypeDef towerStrength, GameCoreObject to)
        {
            return ReactionRateByStrength(towerStrength, to) > 1.0f;
        }

        // DamageStrongToEnemy @0x943C40 (tables overload)
        // True when this strength+class combo yields the maximum damage multiplier present
        // in the enemy's tables (i.e. no other combo hits harder).
        public static bool DamageStrongToEnemy(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, List<StrengthDamageInfo> strengthInfos, List<ClassDamageInfo> classInfos)
        {
            float rate = DamageRateByStrength(towerStrength, strengthInfos) * DamageRateByClass(towerClass, classInfos);
            float max = 0.0f;
            for (int i = 0; i < strengthInfos.Count; i++)
            {
                for (int j = 0; j < classInfos.Count; j++)
                {
                    max = Mathf.Max(strengthInfos[i].damageTime * classInfos[j].damageTime, max);
                }
            }
            return max <= rate;
        }

        // DamageStrongToEnemy @0x943E30 (target overload)
        public static bool DamageStrongToEnemy(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, GameCoreObject to)
        {
            if (to == null)
                return false;
            GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(to.handle);
            if (view == null)
                return false;
            EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
            if (attrs == null)
                return false;
            return DamageStrongToEnemy(towerStrength, towerClass, attrs.strengthDamageInfos, attrs.classDamageInfos);
        }

        // ReactionStrongToEnemy @0x943F70 (tables overload)
        public static bool ReactionStrongToEnemy(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, List<StrengthDamageInfo> strengthInfos, List<ClassDamageInfo> classInfos)
        {
            float rate = ReactionRateByStrength(towerStrength, strengthInfos) * ReactionRateByClass(towerClass, classInfos);
            float max = 0.0f;
            for (int i = 0; i < strengthInfos.Count; i++)
            {
                for (int j = 0; j < classInfos.Count; j++)
                {
                    max = Mathf.Max(strengthInfos[i].reactionTime * classInfos[j].reactionTime, max);
                }
            }
            return max <= rate;
        }

        // ReactionStrongToEnemy @0x9441A0 (target overload)
        public static bool ReactionStrongToEnemy(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, GameCoreObject to)
        {
            if (to == null)
                return false;
            GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(to.handle);
            if (view == null)
                return false;
            EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
            if (attrs == null)
                return false;
            return ReactionStrongToEnemy(towerStrength, towerClass, attrs.strengthDamageInfos, attrs.classDamageInfos);
        }

        // ReactionRateByStrength @0x943920 (table overload) — reactionTime for matching strength.
        public static float ReactionRateByStrength(EEnemyStrengthTypeDef towerStrength, List<StrengthDamageInfo> strengthInfos)
        {
            float rate = 1.0f;
            if (strengthInfos != null)
            {
                foreach (StrengthDamageInfo info in strengthInfos)
                {
                    if (info.strength == towerStrength)
                    {
                        rate = info.reactionTime;
                        break;
                    }
                }
            }
            return rate;
        }

        // ReactionRateByStrength @0x943AD0 (target overload)
        public static float ReactionRateByStrength(EEnemyStrengthTypeDef towerStrength, GameCoreObject target)
        {
            float rate = 1.0f;
            if (target != null)
            {
                GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(target.handle);
                if (view != null)
                {
                    EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
                    if (attrs != null)
                        rate = ReactionRateByStrength(towerStrength, attrs.strengthDamageInfos);
                }
            }
            return rate;
        }

        // ReactionRateByClass @0x9435A0 (table overload)
        public static float ReactionRateByClass(EEnemyClassTypeDef towerClass, List<ClassDamageInfo> classInfos)
        {
            float rate = 1.0f;
            if (classInfos != null)
            {
                foreach (ClassDamageInfo info in classInfos)
                {
                    if (info.classType == towerClass)
                    {
                        rate = info.reactionTime;
                        break;
                    }
                }
            }
            return rate;
        }

        // ReactionRateByClass @0x943750 (target overload)
        public static float ReactionRateByClass(EEnemyClassTypeDef towerClass, GameCoreObject target)
        {
            float rate = 1.0f;
            if (target != null)
            {
                GameObject view = Q4.GameCoreBridge.Instance.GetUnityObject(target.handle);
                if (view != null)
                {
                    EnemyAttributesSettings attrs = view.GetComponent<EnemyAttributesSettings>();
                    if (attrs != null)
                        rate = ReactionRateByClass(towerClass, attrs.classDamageInfos);
                }
            }
            return rate;
        }

        // ReactionRateByAttributes @0x944160 (tables overload)
        public static float ReactionRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, List<StrengthDamageInfo> strengthTable, List<ClassDamageInfo> classTable)
        {
            return ReactionRateByStrength(towerStrength, strengthTable) * ReactionRateByClass(towerClass, classTable);
        }

        // ReactionRateByAttributes @0x9442E0 (settings overload)
        public static float ReactionRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, EnemyAttributesSettings attributes)
        {
            if (attributes == null)
                return 1.0f;
            return ReactionRateByStrength(towerStrength, attributes.strengthDamageInfos)
                 * ReactionRateByClass(towerClass, attributes.classDamageInfos);
        }

        // ReactionRateByAttributes @0x944390 (target overload)
        public static float ReactionRateByAttributes(EEnemyStrengthTypeDef towerStrength, EEnemyClassTypeDef towerClass, GameCoreObject target)
        {
            if (target == null)
                return 1.0f;
            return ReactionRateByStrength(towerStrength, target) * ReactionRateByClass(towerClass, target);
        }

        // GetEnemyOnHitSound @0x9443E0
        // Picks the hit SFX: a "protected" sound if the enemy resists the source tower's
        // class via a shield, otherwise the effective/ineffective damage sound.
        public static AudioClip GetEnemyOnHitSound(EnemyHitInfo hitInfo, EnemyBase soundSetting)
        {
            // Resolve the view of the tower that dealt the damage (via projectile, or via a
            // buff's source projectile).
            TowerBase sourceTower = null;
            GameCoreObject src = hitInfo.damageSource;
            if (src is GameCoreProjectile projectile)
            {
                sourceTower = projectile.sourceTower.GetUnityObject<TowerBase>();
            }
            else if (src is Buff buff)
            {
                if (buff.SourceProjectile != GameCoreHandle.nullHandle)
                {
                    GameCoreProjectile srcProj = buff.SourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>();
                    if (srcProj != null)
                        sourceTower = srcProj.sourceTower.GetUnityObject<TowerBase>();
                }
            }
            if (sourceTower == null)
                return null;

            EnemyAttributesSettings attrs = soundSetting.GetComponent<EnemyAttributesSettings>();
            List<EEnemyClassTypeDef> weakClasses = WeakDamageClassTypes(soundSetting.gameObject);

            if (weakClasses.Contains(EEnemyClassTypeDef.Magic) &&
                sourceTower.classType == EEnemyClassTypeDef.Magic &&
                attrs.HasShieldEffect(EEnemyClassTypeDef.Magic))
            {
                return GlobalSounds.EnemyProtectedByMagic;
            }
            if (weakClasses.Contains(EEnemyClassTypeDef.Physic) &&
                sourceTower.classType == EEnemyClassTypeDef.Physic &&
                attrs.HasShieldEffect(EEnemyClassTypeDef.Physic))
            {
                return GlobalSounds.EnemyProtectedByForceField;
            }
            return hitInfo.strongToDamage ? soundSetting.damageEffectiveSound : soundSetting.damageIneffectiveSound;
        }
    }
}